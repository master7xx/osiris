import { createIdentitySnapshot, replayIdentitySnapshot } from './identity-reconciliation-snapshot';
import { applyReviewedSplit, splitReviewHash, splitPayloadHash, type ReviewedSplit } from './reviewed-event-split';
import { identityConflictReport } from './identity-conflict-report';
import { eventStoreStatus } from './event-store-status';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrateEvents } from '../../tools/migrate-events.mjs';
import { DurableEventStore, type EventWrite } from './durable-event-store';
import { acquireCollectorLease, releaseCollectorLease } from './event-collector-lease';
import { DurableEventReader } from './durable-event-reader';
import { collectorIdentities, observationIndex } from './collector-observations';
import type { FusedEvent } from './event-fusion';

const databaseUrl = process.env.EVENT_TEST_DATABASE_URL;
const event = (overrides: Partial<FusedEvent> = {}): FusedEvent => ({
  id: 'fused-a', title: 'Reported earthquake', description: 'Initial report', category: 'earthquake', categories: ['earthquake'],
  occurred_at: '2026-09-12T08:00:00Z', first_seen_at: '2026-09-12T08:01:00Z', last_seen_at: '2026-09-12T08:01:00Z',
  lat: 1, lng: 2, location: 'Test', location_confidence: 1, severity: 50, priority_score: 60,
  confidence: 'confirmed', status: 'active', evidence: [{ source_id: 'usgs', source: 'USGS', kind: 'sensor', independent: true, weight: 1, url: 'https://example.org/quake/1' }],
  sources: ['USGS'], source_count: 1, independent_sources: 1, evidence_weight: 1, urls: ['https://example.org/quake/1'], tags: [], age_minutes: 0, ...overrides,
});
const write = (overrides: Partial<FusedEvent> = {}, expectedRevision: string | null = null): EventWrite => ({
  identities: [{ sourceId: 'usgs', upstreamId: 'quake-1' }], event: event(overrides), expectedRevision,
});

describe.skipIf(!databaseUrl)('PostgreSQL durable event transactions', () => {
  let pool: pg.Pool;
  let store: DurableEventStore;
  beforeAll(async () => {
    if (!new URL(databaseUrl!).pathname.endsWith('_test')) throw new Error('Tests require a dedicated database name ending in _test');
    pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    await migrateEvents(pool); await migrateEvents(pool);
    store = new DurableEventStore(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE osiris_events.collector, osiris_events.signals, osiris_events.batches, osiris_events.evidence, osiris_events.identities, osiris_events.revisions, osiris_events.events');
    await pool.query('UPDATE osiris_events.metadata SET cursor=0, retention_floor=0');
  });
  afterAll(async () => { await pool?.end(); });

  it('keeps identities, replay and history stable across 60 observation cycles and a writer restart', async () => {
    const reader = new DurableEventReader(pool);
    let replayCursor = (await reader.bootstrap()).cursor;
    let owner = randomUUID();
    let activePool = pool;
    let restartedPool: pg.Pool | undefined;
    let writer = store;
    const stableIds = new Map<string, string>();
    const baseTime = Date.parse('2026-09-10T00:00:00Z');
    let observedA = '';
    try {
      for (let cycle = 0; cycle < 60; cycle++) {
        if (cycle === 35) {
          restartedPool = new pg.Pool({ connectionString: databaseUrl });
          activePool = restartedPool;
          writer = new DurableEventStore(activePool);
          owner = randomUUID();
        }
        const stamp = new Date(baseTime + cycle * 90000).toISOString();
        // A is retained during ten missed polls; B continues to be observed.
        if (cycle < 20 || cycle >= 30) observedA = stamp;
        const reports = ['A', 'B'].map(serial => event({
          id: `transient-${serial}-${cycle}`,
          description: serial === 'A' && cycle >= 40 ? 'Corrected report' : 'Original report',
          age_minutes: cycle, priority_score: 100 - cycle,
          first_seen_at: stamp, last_seen_at: stamp,
          evidence: [{ source_id: 'bulletins', source: 'Bulletins', kind: 'official', independent: true,
            weight: 1, upstream_id: serial, url: 'https://example.org/bulletins' }],
        }));
        const observedAt = observationIndex(reports.map(report => ({
          payload: report, observed_at: report.evidence[0].upstream_id === 'A' ? observedA : stamp,
        })));
        const previous = (await reader.bootstrap()).events;
        const lease = (await acquireCollectorLease(activePool, owner))!;
        expect(lease).not.toBeNull();
        try {
          await writer.commitBatch(randomUUID(), reports.map(report => ({
            event: report, identities: collectorIdentities(report), observedAt: observedAt(report),
            expectedRevision: previous.find(row => row.payload.evidence[0].upstream_id === report.evidence[0].upstream_id)?.revision ?? null,
          })), lease);
        } finally { await releaseCollectorLease(activePool, lease); }
        const snapshot = await reader.bootstrap();
        expect(snapshot.events).toHaveLength(2);
        for (const row of snapshot.events) {
          const serial = row.payload.evidence[0].upstream_id as string;
          if (cycle === 0) stableIds.set(serial, row.id);
          expect(row.id).toBe(stableIds.get(serial));
          expect(row.revision).toBe(serial === 'A' && cycle >= 40 ? '2' : '1');
          expect(row.last_observed_at.toISOString()).toBe(serial === 'A' ? observedA : stamp);
        }
        const replay = await reader.changes(replayCursor);
        expect(replay.changes).toHaveLength(cycle === 0 ? 2 : cycle === 40 ? 1 : 0);
        expect(replay.observations).toHaveLength(2);
        expect(replay.has_more).toBe(false);
        replayCursor = replay.cursor;
      }
      for (const [table, count] of [['events', '2'], ['identities', '2'], ['evidence', '2'], ['revisions', '3'], ['batches', '60']]) {
        expect((await pool.query(`SELECT count(*) FROM osiris_events.${table}`)).rows[0].count).toBe(count);
      }
      expect((await pool.query('SELECT cursor FROM osiris_events.metadata')).rows[0].cursor).toBe('3');
    } finally { await restartedPool?.end(); }
  }, 30000);

  it('reports storage without changing replay metadata or event history', async () => {
    await store.commitBatch(randomUUID(), [write()]);
    const before = await new DurableEventReader(pool).bootstrap();
    const report = await eventStoreStatus(pool);
    expect(report.metadata.cursor).toBe('1');
    expect(report.first_revision.cursor).toBe('1');
    expect(report.last_revision.cursor).toBe('1');
    expect(report.tables.map(row => row.name)).toContain('batches');
    expect(BigInt(report.total_bytes)).toBeGreaterThan(BigInt(0));
    expect(report.collector).toBeNull();
    expect(await new DurableEventReader(pool).bootstrap()).toEqual(before);
    expect((await pool.query('SELECT count(*) FROM osiris_events.revisions')).rows[0].count).toBe('1');
  });

  it('reports collector warnings and redacts unknown stored errors without modifying them', async () => {
    await pool.query(`INSERT INTO osiris_events.collector (owner,generation,expires_at,last_error)
      VALUES ($1,1,clock_timestamp(),$2)`, [randomUUID(), '12 candidates skipped: identity reconciliation required']);
    const before = (await pool.query('SELECT * FROM osiris_events.collector')).rows;
    const report = await eventStoreStatus(pool);
    expect(report.collector).toMatchObject({ has_error: true, category: 'identity_reconciliation', level: 'warning', skipped_candidates: '12' });
    expect(report.collector).not.toHaveProperty('last_error');
    expect((await pool.query('SELECT * FROM osiris_events.collector')).rows).toEqual(before);
    const privateError = 'postgres://private-user:private-password@private-host/db';
    await pool.query('UPDATE osiris_events.collector SET last_error=$1', [privateError]);
    const redacted = await eventStoreStatus(pool);
    expect(redacted.collector).toMatchObject({ category: 'unclassified', level: 'error', skipped_candidates: null });
    expect(JSON.stringify(redacted)).not.toContain(privateError);
    expect((await pool.query('SELECT last_error FROM osiris_events.collector')).rows[0].last_error).toBe(privateError);
  });

  it('reconstructs a bridge between persisted events without changing history', async () => {
    const first = write();
    first.identities = collectorIdentities(first.event);
    const second = write({ evidence: [{ ...first.event.evidence[0], url: 'https://example.org/quake/2' }] });
    second.identities = collectorIdentities(second.event);
    const committed = await store.commitBatch(randomUUID(), [first, second]);
    const before = await new DurableEventReader(pool).bootstrap();
    const signal = { ...first.event, evidence: [...first.event.evidence, ...second.event.evidence] };
    await pool.query('INSERT INTO osiris_events.signals (id,payload) VALUES ($1,$2)', ['diagnostic', JSON.stringify(signal)]);
    const report = await identityConflictReport(pool);
    expect(report.signal_count).toBe(1);
    expect(report.candidate_count).toBe(1);
    expect(report.skipped_candidates).toBe(1);
    expect(report.conflicts[0].reason).toBe('multiple_stored_events');
    expect(report.conflicts[0].links.flatMap(link => link.events.map(e => e.id)).sort())
      .toEqual(committed.events.map(e => e.id).sort());
    expect(report.cursor).toBe('2');
    expect(await new DurableEventReader(pool).bootstrap()).toEqual(before);
    expect((await pool.query('SELECT count(*) FROM osiris_events.signals')).rows[0].count).toBe('1');
  });

  it('dry-runs split proposals and blocks missing historical identities without writes', async () => {
    const evidence = (id: string) => ({ source_id: 'usgs-earthquakes', source: 'USGS', kind: 'sensor' as const, independent: true, weight: 1, url: `https://example.org/${id}` });
    const a = event({ id: 'usgs:a', evidence: [evidence('a')] });
    const b = event({ id: 'usgs:b', evidence: [evidence('b')] });
    const merged = { ...a, evidence: [...a.evidence, ...b.evidence] };
    const result = await store.commitBatch(randomUUID(), [{ event: merged, identities: collectorIdentities(merged), expectedRevision: null }]);
    await pool.query('INSERT INTO osiris_events.signals (id,payload) VALUES ($1,$2),($3,$4)', ['a', JSON.stringify(a), 'b', JSON.stringify(b)]);
    const before = await new DurableEventReader(pool).bootstrap();
    const report = await identityConflictReport(pool, true);
    expect(report.reconciliation?.executable).toBe(false);
    expect(report.reconciliation?.groups[0].action).toBe('propose_split_for_review');
    expect(report.reconciliation?.groups[0].partitions).toHaveLength(2);
    const captured = await identityConflictReport(pool, true, { previousIds: [result.events[0].id] });
    const snapshot = createIdentitySnapshot(captured);
    const replay = replayIdentitySnapshot(snapshot);
    expect(replay.reconciliation.groups).toEqual(captured.reconciliation?.groups);
    expect(captured.snapshotData?.history).toHaveLength(1);
    await pool.query("UPDATE osiris_events.signals SET observed_at=clock_timestamp()-interval '72 hours'");
    const expired = await identityConflictReport(pool, true, { previousIds: [result.events[0].id] });
    expect(expired.reconciliation?.groups[0].blockers).toContain('identity_not_in_retained_signals');
    expect(replayIdentitySnapshot(snapshot)).toEqual(replay);
    await pool.query('UPDATE osiris_events.signals SET observed_at=clock_timestamp()');
    expect(await new DurableEventReader(pool).bootstrap()).toEqual(before);
    await pool.query('INSERT INTO osiris_events.identities (source_id,upstream_id,event_id) VALUES ($1,$2,$3)', ['usgs-earthquakes', 'expired', result.events[0].id]);
    const blocked = await identityConflictReport(pool, true);
    expect(blocked.reconciliation?.groups[0].blockers).toContain('identity_not_in_retained_signals');
    expect(blocked.reconciliation?.groups[0].proposed_changes).toBeNull();
    expect((await pool.query('SELECT count(*) FROM osiris_events.identities')).rows[0].count).toBe('3');
    expect(await new DurableEventReader(pool).bootstrap()).toEqual(before);
  });

  async function splitFixture() {
    const a = write();
    a.identities = collectorIdentities(a.event);
    const b = write({ title: 'Separate earthquake', evidence: [{ ...a.event.evidence[0], url: 'https://example.org/quake/2' }] });
    b.identities = collectorIdentities(b.event);
    const parentEvent = { ...a.event, evidence: [...a.event.evidence, ...b.event.evidence] };
    const result = await store.commitBatch(randomUUID(), [{ event: parentEvent, identities: [...a.identities, ...b.identities], expectedRevision: null }]);
    const parent = (await pool.query('SELECT payload FROM osiris_events.events WHERE id=$1', [result.events[0].id])).rows[0];
    const plan: ReviewedSplit = { operation_id: randomUUID(), epoch: result.epoch, cursor: result.cursor,
      parent_id: result.events[0].id, parent_revision: '1', parent_payload_hash: splitPayloadHash(parent.payload),
      children: [a,b].map(w => ({ event: w.event, identities: w.identities, observed_at: '2026-09-12T08:00:00Z' })) };
    return plan;
  }
  it('atomically splits reviewed identities, retains history and replays replacement idempotently', async () => {
    const plan = await splitFixture();
    const reader = new DurableEventReader(pool);
    const before = await reader.bootstrap();
    const result = await applyReviewedSplit(pool, plan, splitReviewHash(plan));
    expect(result.child_ids).toHaveLength(2);
    expect(result.cursor).toBe('4');
    expect(await applyReviewedSplit(pool, plan, splitReviewHash(plan))).toEqual(result);
    const after = await reader.bootstrap();
    expect(after.events).toHaveLength(3);
    expect(after.events.find(e => e.id === plan.parent_id).payload.replaced_by).toEqual(result.child_ids);
    expect((await pool.query('SELECT count(*) FROM osiris_events.revisions')).rows[0].count).toBe('4');
    expect((await pool.query('SELECT count(*) FROM osiris_events.evidence WHERE event_id=$1', [plan.parent_id])).rows[0].count).toBe('2');
    const changed = await reader.changes(before.cursor);
    expect(changed.changes).toHaveLength(3);
    expect(changed.changes[2].payload.replaced_by).toEqual(result.child_ids);
    expect((await pool.query('SELECT DISTINCT event_id FROM osiris_events.identities')).rows.map(r => r.event_id).sort()).toEqual([...result.child_ids].sort());
    const changedPlan = { ...plan, parent_revision: '2' };
    await expect(applyReviewedSplit(pool, changedPlan, splitReviewHash(changedPlan))).rejects.toThrow('reused');
  });
  it('rejects changed approval, snapshot, parent payload, identities and active collector', async () => {
    const plan = await splitFixture();
    const before = await new DurableEventReader(pool).bootstrap();
    await expect(applyReviewedSplit(pool, plan, 'wrong')).rejects.toThrow('review changed');
    for (const altered of [{ ...plan, cursor: '0' }, { ...plan, parent_payload_hash: 'changed' },
      { ...plan, children: [plan.children[0], { ...plan.children[1], identities: plan.children[0].identities }] }]) {
      await expect(applyReviewedSplit(pool, altered, splitReviewHash(altered))).rejects.toThrow();
    }
    const lease = await acquireCollectorLease(pool, randomUUID());
    await expect(applyReviewedSplit(pool, plan, splitReviewHash(plan))).rejects.toThrow('Stop collector');
    await releaseCollectorLease(pool, lease!);
    expect((await new DurableEventReader(pool).bootstrap()).events).toEqual(before.events);
    expect((await new DurableEventReader(pool).bootstrap()).cursor).toEqual(before.cursor);
  });
  it('rolls back children, identities and replay cursor when a later child insert fails', async () => {
    const plan = await splitFixture();
    plan.children[1].event.title = 'reject split test';
    const before = await new DurableEventReader(pool).bootstrap();
    await pool.query(`ALTER TABLE osiris_events.events ADD CONSTRAINT reject_split_test CHECK (payload->>'title' <> 'reject split test')`);
    try {
      await expect(applyReviewedSplit(pool, plan, splitReviewHash(plan))).rejects.toThrow();
      expect(await new DurableEventReader(pool).bootstrap()).toEqual(before);
      expect((await pool.query('SELECT count(*) FROM osiris_events.identities WHERE event_id=$1', [plan.parent_id])).rows[0].count).toBe('2');
      expect((await pool.query('SELECT count(*) FROM osiris_events.batches WHERE id=$1', [plan.operation_id])).rows[0].count).toBe('0');
    } finally { await pool.query('ALTER TABLE osiris_events.events DROP CONSTRAINT reject_split_test'); }
  });

  it('stores distinct bulletins sharing a URL and revises only the corrected serial', async () => {
    const bulletin = (serial: string, description = 'Original') => event({
      id: `swpc-${serial}`, description,
      evidence: [{ source_id: 'noaa-swpc', source: 'NOAA / SWPC', kind: 'official', independent: true,
        weight: 1.2, upstream_id: serial, url: 'https://services.swpc.noaa.gov/products/alerts.json' }],
    });
    const a = bulletin('10'); const b = bulletin('11');
    await store.commitBatch(randomUUID(), [a, b].map(item => ({ event: item, identities: collectorIdentities(item), expectedRevision: null })));
    const correction = bulletin('10', 'Corrected');
    await store.commitBatch(randomUUID(), [{ event: correction, identities: collectorIdentities(correction), expectedRevision: '1' }]);
    const snapshot = await new DurableEventReader(pool).bootstrap();
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.find(row => row.payload.evidence[0].upstream_id === '10')?.payload.description).toBe('Corrected');
    expect(snapshot.events.find(row => row.payload.evidence[0].upstream_id === '11')?.revision).toBe('1');
  });

  it('persists cancellation and supersession metadata as a material revision', async () => {
    await store.commitBatch(randomUUID(), [write()]);
    const metadata = { withdrawn: true, supersedes: ['https://api.weather.gov/alerts/old'] };
    await store.commitBatch(randomUUID(), [write(metadata, '1')]);
    const reader = new DurableEventReader(pool);
    const snapshot = await reader.bootstrap();
    expect(snapshot.events[0].payload).toMatchObject(metadata);
    expect((await pool.query('SELECT count(*) FROM osiris_events.revisions')).rows[0].count).toBe('2');
    await store.commitBatch(randomUUID(), [write(metadata, '2')]);
    expect((await pool.query('SELECT count(*) FROM osiris_events.revisions')).rows[0].count).toBe('2');
  });
  it('recovers identity through a new connection and does not revise freshness changes', async () => {
    const first = await store.commitBatch(randomUUID(), [write()]);
    const otherPool = new pg.Pool({ connectionString: databaseUrl });
    try {
      const second = await new DurableEventStore(otherPool).commitBatch(randomUUID(), [write({ age_minutes: 12, priority_score: 30, id: 'different-fusion-id' })]);
      expect(second).toEqual(first);
      expect((await pool.query('SELECT count(*) FROM osiris_events.revisions')).rows[0].count).toBe('1');
    } finally { await otherPool.end(); }
  });
  it('replays the same batch exactly and rejects batch ID reuse', async () => {
    const batch = randomUUID();
    const first = await store.commitBatch(batch, [write()]);
    expect(await store.commitBatch(batch, [write()])).toEqual(first);
    await expect(store.commitBatch(batch, [write({ title: 'Different' })])).rejects.toThrow('different input');
  });
  it('rolls back event, evidence, identity, revision and cursor together', async () => {
    const invalid = write({}, '9'); invalid.identities[0].upstreamId = 'other';
    await expect(store.commitBatch(randomUUID(), [write(), invalid])).rejects.toThrow('Revision conflict');
    for (const table of ['events', 'evidence', 'identities', 'revisions', 'batches']) {
      expect((await pool.query(`SELECT count(*) FROM osiris_events.${table}`)).rows[0].count).toBe('0');
    }
    expect((await pool.query('SELECT cursor FROM osiris_events.metadata')).rows[0].cursor).toBe('0');
  });
  it('serializes concurrent writes and rejects a stale revision', async () => {
    await store.commitBatch(randomUUID(), [write()]);
    const results = await Promise.allSettled([
      store.commitBatch(randomUUID(), [write({ title: 'Update A' }, '1')]),
      store.commitBatch(randomUUID(), [write({ title: 'Update B' }, '1')]),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await pool.query('SELECT cursor, revision FROM osiris_events.revisions ORDER BY cursor')).rows).toEqual([
      { cursor: '1', revision: '1' }, { cursor: '2', revision: '2' },
    ]);
  });
  it('makes concurrent identical creation idempotent', async () => {
    const results = await Promise.all([store.commitBatch(randomUUID(), [write()]), store.commitBatch(randomUUID(), [write()])]);
    expect(results[0]).toEqual(results[1]);
  });
  it('retains historical evidence when current evidence shrinks', async () => {
    await store.commitBatch(randomUUID(), [write()]);
    await store.commitBatch(randomUUID(), [write({ evidence: [], sources: [], source_count: 0, independent_sources: 0, confidence: 'unconfirmed' }, '1')]);
    expect((await pool.query('SELECT count(*) FROM osiris_events.evidence')).rows[0].count).toBe('1');
    const current = (await pool.query('SELECT payload FROM osiris_events.events')).rows[0].payload;
    expect(current.evidence).toEqual([]); expect(current.confidence).toBe('unconfirmed');
  });
  it('rejects ambiguous aliases instead of merging two stored events', async () => {
    await store.commitBatch(randomUUID(), [write()]);
    const other = write(); other.identities[0].upstreamId = 'other';
    await store.commitBatch(randomUUID(), [other]);
    const ambiguous = write(); ambiguous.identities.push(other.identities[0]);
    await expect(store.commitBatch(randomUUID(), [ambiguous])).rejects.toThrow('Identity conflict');
  });
  it('pages a fixed replay boundary while concurrent ingestion advances the store', async () => {
    await store.commitBatch(randomUUID(), [write()]);
    await store.commitBatch(randomUUID(), [write({ title: 'Second' }, '1')]);
    const reader = new DurableEventReader(pool);
    const page = await reader.changes(undefined, 1);
    expect(page.has_more).toBe(true);
    await store.commitBatch(randomUUID(), [write({ title: 'Third' }, '2')]);
    const end = await reader.changes(page.cursor, 1);
    expect(end.changes.map(row => row.cursor)).toEqual(['2']);
    expect(end.has_more).toBe(false);
    expect((await reader.changes(end.cursor)).changes.map(row => row.cursor)).toEqual(['3']);
  });
  it('bootstraps current events and resumes without replaying earlier revisions', async () => {
    const first = await store.commitBatch(randomUUID(), [write()]);
    const reader = new DurableEventReader(pool);
    const snapshot = await reader.bootstrap();
    expect(snapshot.events[0].id).toBe(first.events[0].id);
    expect((await reader.changes(snapshot.cursor)).changes).toEqual([]);
    await store.commitBatch(randomUUID(), [write({ title: 'Second' }, '1')]);
    expect((await reader.changes(snapshot.cursor)).changes).toHaveLength(1);
  });
  it('requires reset for malformed cursors and after epoch rotation', async () => {
    const reader = new DurableEventReader(pool);
    const snapshot = await reader.bootstrap();
    await expect(reader.changes('bad')).rejects.toThrow('bootstrap required');
    await pool.query('UPDATE osiris_events.metadata SET epoch=$1', [randomUUID()]);
    await expect(reader.changes(snapshot.cursor)).rejects.toThrow('bootstrap required');
  });

  it('fences a paused collector after lease expiry and takeover', async () => {
    const first = await acquireCollectorLease(pool, randomUUID());
    expect(first).not.toBeNull();
    expect(await acquireCollectorLease(pool, randomUUID())).toBeNull();
    await expect(store.commitBatch(randomUUID(), [write()])).rejects.toThrow('lease');
    await pool.query("UPDATE osiris_events.collector SET expires_at=clock_timestamp()-interval '1 second'");
    const second = await acquireCollectorLease(pool, randomUUID());
    expect(BigInt(second!.generation)).toBeGreaterThan(BigInt(first!.generation));
    await expect(store.commitBatch(randomUUID(), [write()], first!)).rejects.toThrow('lease');
    await store.commitBatch(randomUUID(), [write()], second!);
  });

  it('serves durable API data without starting network collection', async () => {
    const lease = (await acquireCollectorLease(pool, randomUUID()))!;
    await store.commitBatch(randomUUID(), [write()], lease);
    await pool.query("UPDATE osiris_events.collector SET last_success_at=clock_timestamp(),source_health='[]'");
    const previousMode = process.env.EVENT_READ_MODE;
    const previousUrl = process.env.EVENT_DATABASE_URL;
    process.env.EVENT_READ_MODE = 'durable'; process.env.EVENT_DATABASE_URL = databaseUrl;
    const fetchMock = vi.fn(() => { throw new Error('Network collection must not run'); });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { getUnifiedEventFeed } = await import('./event-feed');
      const result = await getUnifiedEventFeed();
      expect(result.events).toHaveLength(1);
      expect(result.events[0].title).toBe('Reported earthquake');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previousMode === undefined) delete process.env.EVENT_READ_MODE; else process.env.EVENT_READ_MODE = previousMode;
      if (previousUrl === undefined) delete process.env.EVENT_DATABASE_URL; else process.env.EVENT_DATABASE_URL = previousUrl;
      await globalThis.__OSIRIS_EVENT_DATABASE__?.end(); globalThis.__OSIRIS_EVENT_DATABASE__ = undefined;
      vi.unstubAllGlobals();
    }
  });

  it('does not renew observation freshness when replaying retained source signals', async () => {
    const item = { ...write(), observedAt: '2026-09-10T01:00:00Z' };
    await store.commitBatch(randomUUID(), [item]);
    await store.commitBatch(randomUUID(), [{ ...item, event: { ...item.event, priority_score: 20 } }]);
    const row = (await pool.query('SELECT first_observed_at,last_observed_at FROM osiris_events.events')).rows[0];
    expect(row.last_observed_at.toISOString()).toBe('2026-09-10T01:00:00.000Z');
    expect(row.first_observed_at.toISOString()).toBe('2026-09-10T01:00:00.000Z');
  });

});
