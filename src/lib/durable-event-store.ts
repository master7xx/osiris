import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FusedEvent } from './event-fusion';

export interface UpstreamIdentity { sourceId: string; upstreamId: string }
export interface EventWrite {
  identities: UpstreamIdentity[];
  event: FusedEvent;
  /** null permits creation only; existing events require their last read revision. */
  expectedRevision: string | null;
}
export interface BatchResult { epoch: string; cursor: string; events: { id: string; revision: string; cursor: string }[] }
interface StoredRow { id: string; revision: string; cursor: string; content_hash: string }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function hash(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function normalizedContent(event: FusedEvent) {
  // Derived freshness/ranking and upstream fusion IDs do not create revisions.
  const content = { ...event } as Partial<FusedEvent>;
  delete content.id; delete content.age_minutes; delete content.priority_score;
  delete content.first_seen_at; delete content.last_seen_at;
  for (const key of ['categories', 'sources', 'urls', 'tags'] as const) {
    // Sort copies; caller data and evidence order remain untouched.
    Object.assign(content, { [key]: [...event[key]].sort() });
  }
  content.evidence = [...event.evidence].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return content;
}

/** Store primitive only: adapters supply exact identities; no new fuzzy matching rules. */
export class DurableEventStore {
  constructor(private readonly pool: Pool) {}

  async commitBatch(batchId: string, input: EventWrite[], lease?: { owner: string; generation: string }): Promise<BatchResult> {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(batchId)) throw new Error('Invalid batch UUID');
    if (!input.length || input.length > 300) throw new Error('Batch must contain 1–300 events');
    // Snapshot before waiting for a connection; callers cannot mutate a queued batch.
    const writes = structuredClone(input);
    for (const write of writes) {
      if (!write.identities.length || write.identities.some(id => !id.sourceId.trim() || !id.upstreamId.trim())) throw new Error('Upstream identity required');
      if (write.expectedRevision !== null && !/^[1-9][0-9]*$/.test(write.expectedRevision)) throw new Error('Invalid expected revision');
    }
    const inputHash = hash(writes);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      const meta = await client.query<{ epoch: string; cursor: string }>('SELECT epoch, cursor FROM osiris_events.metadata WHERE singleton FOR UPDATE');
      if (!meta.rows.length) throw new Error('Event store requires migration');
      const ownership = (await client.query('SELECT owner,generation,expires_at>clock_timestamp() AS active FROM osiris_events.collector WHERE singleton')).rows[0];
      if (lease ? !ownership?.active || ownership.owner !== lease.owner || ownership.generation !== lease.generation : ownership?.active) throw new Error('Collector lease required or expired');
      const prior = await client.query<{ input_hash: string; result: BatchResult }>('SELECT input_hash, result FROM osiris_events.batches WHERE id=$1', [batchId]);
      if (prior.rows.length) {
        if (prior.rows[0].input_hash !== inputHash) throw new Error('Batch ID reused with different input');
        await client.query('COMMIT'); return prior.rows[0].result;
      }
      let cursor = BigInt(meta.rows[0].cursor);
      const result: BatchResult = { epoch: meta.rows[0].epoch, cursor: cursor.toString(), events: [] };
      for (const write of writes) {
        const ids = await client.query<{ event_id: string }>(`SELECT DISTINCT event_id FROM osiris_events.identities
          WHERE (source_id, upstream_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
        [write.identities.map(id => id.sourceId), write.identities.map(id => id.upstreamId)]);
        if (ids.rows.length > 1) throw new Error('Identity conflict: explicit reconciliation required');
        const existing = ids.rows.length ? (await client.query<StoredRow>('SELECT id, revision, cursor, content_hash FROM osiris_events.events WHERE id=$1', [ids.rows[0].event_id])).rows[0] : undefined;
        const contentHash = hash(normalizedContent(write.event));
        const changed = !existing || existing.content_hash !== contentHash;
        if (changed && (existing?.revision ?? null) !== write.expectedRevision) throw new Error('Revision conflict');
        const id = existing?.id ?? randomUUID();
        const revision = changed ? (BigInt(existing?.revision ?? '0') + BigInt(1)).toString() : existing.revision;
        if (changed) {
          cursor += BigInt(1);
          const payload = { ...write.event, id };
          await client.query(`INSERT INTO osiris_events.events (id, revision, cursor, content_hash, payload) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (id) DO UPDATE SET revision=EXCLUDED.revision, cursor=EXCLUDED.cursor,
            content_hash=EXCLUDED.content_hash, payload=EXCLUDED.payload, last_observed_at=clock_timestamp()`,
          [id, revision, cursor.toString(), contentHash, JSON.stringify(payload)]);
          await client.query('INSERT INTO osiris_events.revisions (cursor,event_id,revision,payload) VALUES ($1,$2,$3,$4)', [cursor.toString(), id, revision, JSON.stringify(payload)]);
        } else {
          await client.query('UPDATE osiris_events.events SET last_observed_at=clock_timestamp(),payload=$2 WHERE id=$1', [id, JSON.stringify({ ...write.event, id })]);
        }
        for (const identity of write.identities) await client.query(`INSERT INTO osiris_events.identities (source_id,upstream_id,event_id)
          VALUES ($1,$2,$3) ON CONFLICT (source_id,upstream_id) DO NOTHING`, [identity.sourceId, identity.upstreamId, id]);
        for (const evidence of write.event.evidence) {
          const key = hash([evidence.source_id, evidence.url ?? null, evidence.published_at ?? null]);
          await client.query(`INSERT INTO osiris_events.evidence (event_id,evidence_key,payload) VALUES ($1,$2,$3)
            ON CONFLICT (event_id,evidence_key) DO UPDATE SET payload=EXCLUDED.payload,last_observed_at=clock_timestamp()`, [id, key, JSON.stringify(evidence)]);
        }
        result.events.push({ id, revision, cursor: changed ? cursor.toString() : existing!.cursor });
      }
      result.cursor = cursor.toString();
      await client.query('UPDATE osiris_events.metadata SET cursor=$1 WHERE singleton', [result.cursor]);
      await client.query('INSERT INTO osiris_events.batches (id,input_hash,result) VALUES ($1,$2,$3)', [batchId, inputHash, JSON.stringify(result)]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }
}
