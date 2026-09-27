import type { PoolClient } from 'pg';
import type { BatchResult, EventWrite } from './durable-event-store';

interface Match { source_id: string; upstream_id: string; id: string; revision: string; cursor: string; content_hash: string }
const identityKey = (source: string, upstream: string) => JSON.stringify([source, upstream]);

/** Called only inside commitBatch's metadata-locked transaction. Fall back before any mutation. */
export async function refreshUnchangedEvents(client: PoolClient, writes: EventWrite[], hashes: { event: (event: EventWrite['event']) => string; evidence: (item: EventWrite['event']['evidence'][number]) => string }): Promise<BatchResult['events'] | undefined> {
  const keys = [...new Map(writes.flatMap(write => write.identities).map(identity =>
    [identityKey(identity.sourceId, identity.upstreamId), identity])).values()];
  const matches = (await client.query<Match>(`SELECT i.source_id,i.upstream_id,e.id,e.revision,e.cursor,e.content_hash
    FROM osiris_events.identities i JOIN osiris_events.events e ON e.id=i.event_id
    WHERE (i.source_id,i.upstream_id) IN (SELECT * FROM unnest($1::text[],$2::text[]))`,
  [keys.map(key => key.sourceId), keys.map(key => key.upstreamId)])).rows;
  const index = new Map(matches.map(row => [identityKey(row.source_id, row.upstream_id), row]));
  const accepted = new Set<string>();
  const events = [];
  const results: BatchResult['events'] = [];
  const identities = new Map<string, { source_id: string; upstream_id: string; event_id: string }>();
  const evidence = new Map<string, { event_id: string; evidence_key: string; payload: unknown }>();
  for (const write of writes) {
    const linked = [...new Map(write.identities.flatMap(identity => {
      const row = index.get(identityKey(identity.sourceId, identity.upstreamId));
      return row ? [[row.id, row] as const] : [];
    })).values()];
    const row = linked[0];
    // Preserve sequential semantics for creation, revision changes, ambiguity and repeated events.
    if (linked.length !== 1 || accepted.has(row.id) || row.content_hash !== hashes.event(write.event)) return undefined;
    accepted.add(row.id);
    for (const identity of write.identities) {
      const key = identityKey(identity.sourceId, identity.upstreamId);
      if (identities.has(key) && identities.get(key)!.event_id !== row.id) return undefined;
      identities.set(key, { source_id: identity.sourceId, upstream_id: identity.upstreamId, event_id: row.id });
    }
    for (const item of write.event.evidence) {
      const key = hashes.evidence(item);
      evidence.set(JSON.stringify([row.id, key]), { event_id: row.id, evidence_key: key, payload: item });
    }
    events.push({ id: row.id, payload: { ...write.event, id: row.id }, observed_at: write.observedAt ?? null });
    results.push({ id: row.id, revision: row.revision, cursor: row.cursor });
  }
  await client.query(`UPDATE osiris_events.events e SET
    last_observed_at=GREATEST(e.last_observed_at,COALESCE(w.observed_at,clock_timestamp())),payload=w.payload
    FROM jsonb_to_recordset($1::jsonb) AS w(id uuid,payload jsonb,observed_at timestamptz) WHERE e.id=w.id`, [JSON.stringify(events)]);
  // Bound statement size and keep duplicate keys out of each ON CONFLICT statement.
  const identityRows = [...identities.values()];
  for (let start = 0; start < identityRows.length; start += 300) {
    await client.query(`INSERT INTO osiris_events.identities(source_id,upstream_id,event_id)
      SELECT source_id,upstream_id,event_id FROM jsonb_to_recordset($1::jsonb) AS w(source_id text,upstream_id text,event_id uuid)
      ON CONFLICT(source_id,upstream_id) DO NOTHING`, [JSON.stringify(identityRows.slice(start, start + 300))]);
  }
  const evidenceRows = [...evidence.values()];
  for (let start = 0; start < evidenceRows.length; start += 300) {
    await client.query(`INSERT INTO osiris_events.evidence(event_id,evidence_key,payload)
      SELECT event_id,evidence_key,payload FROM jsonb_to_recordset($1::jsonb) AS w(event_id uuid,evidence_key text,payload jsonb)
      ON CONFLICT(event_id,evidence_key) DO UPDATE SET payload=EXCLUDED.payload,last_observed_at=clock_timestamp()`,
    [JSON.stringify(evidenceRows.slice(start, start + 300))]);
  }
  return results;
}
