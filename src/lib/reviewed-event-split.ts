import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { FusedEvent } from './event-fusion';
import { storedEventHash, storedEvidenceKey } from './durable-event-store';

export interface ReviewedSplit {
  operation_id: string;
  epoch: string;
  cursor: string;
  parent_id: string;
  parent_revision: string;
  parent_payload_hash: string;
  children: { event: FusedEvent; identities: { sourceId: string; upstreamId: string }[]; observed_at: string }[];
}
const identityKey = (id: { sourceId: string; upstreamId: string }) => JSON.stringify([id.sourceId, id.upstreamId]);
export function splitPayloadHash(payload: FusedEvent) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
/** Exact document checksum: explicit caller approval, not a signature or authorization. */
export function splitReviewHash(plan: ReviewedSplit) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

/** Caller owns the transaction; used for one split or an atomic package. */
export async function applyReviewedSplitInTransaction(client: PoolClient, plan: ReviewedSplit, approvedHash: string) {
  plan = structuredClone(plan);
  const digest = splitReviewHash(plan);
  if (digest !== approvedHash) throw new Error('Split review changed');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(plan.operation_id)) throw new Error('Invalid operation ID');
  if (plan.children.length < 2 || plan.children.length > 100) throw new Error('Invalid split size');
  const keys = plan.children.flatMap(c => c.identities.map(identityKey));
  if (new Set(keys).size !== keys.length || plan.children.some(c => !c.identities.length)) throw new Error('Split identities must form disjoint partitions');
  for (const child of plan.children) {
    if (!Number.isFinite(Date.parse(child.event.occurred_at)) || !Number.isFinite(child.event.severity)
      || !Number.isFinite(child.event.priority_score) || typeof child.event.description !== 'string'
      || !Array.isArray(child.event.sources) || !child.event.sources.every(s => typeof s === 'string')
      || !Number.isFinite(Date.parse(child.observed_at)) || Date.parse(child.observed_at) > Date.now() + 60000
      || !child.event.title?.trim() || !Array.isArray(child.event.evidence) || child.event.replaced_by?.length) throw new Error('Invalid split payload');
    const evidenceKeys = new Set(child.event.evidence.map(e => identityKey({ sourceId: e.source_id, upstreamId: e.upstream_id || e.url || '' })));
    if (evidenceKeys.size !== child.identities.length || child.identities.some(id => !id.sourceId || !id.upstreamId || !evidenceKeys.has(identityKey(id)))) throw new Error('Split evidence must cover every identity');
  }

    const meta = (await client.query('SELECT epoch,cursor FROM osiris_events.metadata WHERE singleton FOR UPDATE')).rows[0];
    if (!meta || meta.epoch !== plan.epoch) throw new Error('Split epoch changed');
    const prior = (await client.query('SELECT input_hash,result FROM osiris_events.batches WHERE id=$1', [plan.operation_id])).rows[0];
    if (prior) {
      if (prior.input_hash !== `split:${digest}`) throw new Error('Split operation ID reused');
      return prior.result as { parent_id: string; child_ids: string[]; cursor: string };
    }
    if (!meta || meta.epoch !== plan.epoch || meta.cursor !== plan.cursor) throw new Error('Split snapshot changed');
    if ((await client.query('SELECT 1 FROM osiris_events.collector WHERE expires_at>clock_timestamp()')).rowCount) throw new Error('Stop collector before applying split');
    const parent = (await client.query('SELECT revision,payload,last_observed_at FROM osiris_events.events WHERE id=$1 FOR UPDATE', [plan.parent_id])).rows[0];
    if (!parent || parent.revision !== plan.parent_revision || splitPayloadHash(parent.payload) !== plan.parent_payload_hash || parent.payload.replaced_by?.length) throw new Error('Split parent changed');
    const actual = (await client.query('SELECT source_id,upstream_id FROM osiris_events.identities WHERE event_id=$1 ORDER BY source_id,upstream_id', [plan.parent_id])).rows
      .map(r => identityKey({ sourceId: r.source_id, upstreamId: r.upstream_id })).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) throw new Error('Split must preserve all parent identities');
    const childIds = plan.children.map(() => randomUUID());
    let cursor = BigInt(meta.cursor);
    for (const [index, child] of plan.children.entries()) {
      const id = childIds[index];
      const payload = { ...child.event, id };
      cursor++;
      await client.query(`INSERT INTO osiris_events.events (id,revision,cursor,content_hash,payload,first_observed_at,last_observed_at)
        VALUES ($1,1,$2,$3,$4,$5,$5)`, [id, cursor.toString(), storedEventHash(payload), JSON.stringify(payload), child.observed_at]);
      await client.query('INSERT INTO osiris_events.revisions (cursor,event_id,revision,payload) VALUES ($1,$2,1,$3)', [cursor.toString(), id, JSON.stringify(payload)]);
      for (const evidence of payload.evidence) await client.query(`INSERT INTO osiris_events.evidence (event_id,evidence_key,payload)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, storedEvidenceKey(evidence), JSON.stringify(evidence)]);
      for (const identity of child.identities) await client.query(`UPDATE osiris_events.identities SET event_id=$1
        WHERE source_id=$2 AND upstream_id=$3 AND event_id=$4`, [id, identity.sourceId, identity.upstreamId, plan.parent_id]);
    }
    // Historical revisions and evidence of the old record stay intact.
    const retired = { ...parent.payload, replaced_by: childIds } as FusedEvent;
    const revision = (BigInt(parent.revision) + BigInt(1)).toString(); cursor++;
    await client.query('UPDATE osiris_events.events SET revision=$2,cursor=$3,content_hash=$4,payload=$5 WHERE id=$1',
      [plan.parent_id, revision, cursor.toString(), storedEventHash(retired), JSON.stringify(retired)]);
    await client.query('INSERT INTO osiris_events.revisions (cursor,event_id,revision,payload) VALUES ($1,$2,$3,$4)', [cursor.toString(), plan.parent_id, revision, JSON.stringify(retired)]);
    const result = { parent_id: plan.parent_id, child_ids: childIds, cursor: cursor.toString() };
    await client.query('UPDATE osiris_events.metadata SET cursor=$1 WHERE singleton', [result.cursor]);
    await client.query('INSERT INTO osiris_events.batches (id,input_hash,result) VALUES ($1,$2,$3)', [plan.operation_id, `split:${digest}`, JSON.stringify(result)]);
    return result;
}

export async function applyReviewedSplit(pool: Pool, plan: ReviewedSplit, approvedHash: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    const result = await applyReviewedSplitInTransaction(client, plan, approvedHash);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
