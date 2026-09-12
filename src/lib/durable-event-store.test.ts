import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrateEvents } from '../../tools/migrate-events.mjs';
import { DurableEventStore, type EventWrite } from './durable-event-store';
import { acquireCollectorLease } from './event-collector-lease';
import { DurableEventReader } from './durable-event-reader';
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

});
