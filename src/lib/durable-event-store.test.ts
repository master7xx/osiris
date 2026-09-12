import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrateEvents } from '../../tools/migrate-events.mjs';
import { DurableEventStore, type EventWrite } from './durable-event-store';
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
    await pool.query('TRUNCATE osiris_events.batches, osiris_events.evidence, osiris_events.identities, osiris_events.revisions, osiris_events.events');
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
});
