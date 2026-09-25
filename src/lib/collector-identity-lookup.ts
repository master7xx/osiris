import type { Pool } from 'pg';
import { batches } from './collector-observations';

type Identity = { sourceId: string; upstreamId: string };
type StoredMatch = { id: string; revision: string };
const key = (identity: Identity) => JSON.stringify([identity.sourceId, identity.upstreamId]);

/** Resolve exact identities in bounded queries, retaining candidate order and every conflict. */
export async function lookupCollectorIdentities(pool: Pool, groups: Identity[][], beforeBatch: () => Promise<void>) {
  const identities = [...new Map(groups.flat().map(identity => [key(identity), identity])).values()];
  const index = new Map<string, StoredMatch[]>();
  for (const batch of batches(identities)) {
    await beforeBatch();
    const result = await pool.query<StoredMatch & { source_id: string; upstream_id: string }>(`
      SELECT e.id,e.revision,i.source_id,i.upstream_id
      FROM osiris_events.events e JOIN osiris_events.identities i ON i.event_id=e.id
      WHERE (i.source_id,i.upstream_id) IN (SELECT * FROM unnest($1::text[],$2::text[]))`,
    [batch.map(identity => identity.sourceId), batch.map(identity => identity.upstreamId)]);
    for (const row of result.rows) {
      const k = key({ sourceId: row.source_id, upstreamId: row.upstream_id });
      index.set(k, [...(index.get(k) ?? []), { id: row.id, revision: row.revision }]);
    }
  }
  return groups.map(group => [...new Map(group.flatMap(identity => index.get(key(identity)) ?? [])
    .map(match => [match.id, match])).values()]);
}
