import { planIdentityReconciliation } from './identity-reconciliation-plan';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { fuseEvents, type IncomingEvent } from './event-fusion';
import { collectorIdentities } from './collector-observations';

type Identity = { sourceId: string; upstreamId: string };
type Match = { source_id: string; upstream_id: string; event_id: string; revision: string };
const key = (id: Identity) => JSON.stringify([id.sourceId, id.upstreamId]);
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');

/** Same ordered skip rules as collect-events; no automatic reconciliation. */
export function inspectIdentityConflicts(candidates: { id: string; identities: Identity[] }[], matches: Match[]) {
  const index = new Map<string, Match[]>();
  for (const match of matches) {
    const k = key({ sourceId: match.source_id, upstreamId: match.upstream_id });
    index.set(k, [...(index.get(k) ?? []), match]);
  }
  const accepted = new Map<string, number>();
  const conflicts = [];
  for (const [position, candidate] of candidates.entries()) {
    const identities = [...new Map(candidate.identities.map(id => [key(id), id])).values()];
    const links = identities.map(id => ({
      source: id.sourceId, fingerprint: fingerprint(key(id)),
      events: (index.get(key(id)) ?? []).map(m => ({ id: m.event_id, revision: m.revision })),
    }));
    const ids = [...new Set(links.flatMap(link => link.events.map(event => event.id)))];
    const previous = ids.length === 1 ? accepted.get(ids[0]) : undefined;
    if (ids.length > 1 || previous !== undefined) {
      conflicts.push({ position, candidate_fingerprint: fingerprint(candidate.id),
        reason: ids.length > 1 ? 'multiple_stored_events' : 'repeated_stored_event',
        earlier_accepted_position: previous ?? null, links });
    } else if (ids.length === 1) accepted.set(ids[0], position);
  }
  return conflicts;
}

export async function identityConflictReport(pool: Pool, includePlan = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const meta = (await client.query('SELECT epoch,cursor,clock_timestamp() AS sampled_at FROM osiris_events.metadata WHERE singleton')).rows[0];
    if (!meta) throw new Error('Event store requires migration');
    const now = new Date(meta.sampled_at).getTime();
    const rows = (await client.query(`SELECT payload FROM osiris_events.signals
      WHERE observed_at >= $1::timestamptz - interval '48 hours' LIMIT 10001`, [meta.sampled_at])).rows;
    if (rows.length > 10000) throw new Error('Diagnostic signal limit exceeded');
    const candidates = fuseEvents(rows.map(r => r.payload as IncomingEvent), { now, limit: rows.length })
      .map(event => ({ id: event.id, identities: collectorIdentities(event) }));
    const identities = [...new Map(candidates.flatMap(c => c.identities).map(id => [key(id), id])).values()];
    if (identities.length > 100000) throw new Error('Diagnostic identity limit exceeded');
    const matches = (await client.query<Match>(`SELECT i.source_id,i.upstream_id,i.event_id,e.revision
      FROM osiris_events.identities i JOIN osiris_events.events e ON e.id=i.event_id
      WHERE (i.source_id,i.upstream_id) IN (SELECT * FROM unnest($1::text[],$2::text[]))`,
    [identities.map(i => i.sourceId), identities.map(i => i.upstreamId)])).rows;
    const conflicts = inspectIdentityConflicts(candidates, matches);
    let reconciliation;
    if (includePlan) {
      const affected = [...new Set(conflicts.flatMap(c => c.links.flatMap(l => l.events.map(e => e.id))))];
      // Read ALL identities for affected events, not only currently retained keys.
      const allLinks = (await client.query<Match>(`SELECT i.source_id,i.upstream_id,i.event_id,e.revision
        FROM osiris_events.identities i JOIN osiris_events.events e ON e.id=i.event_id
        WHERE i.event_id=ANY($1::uuid[]) LIMIT 100001`, [affected])).rows;
      if (allLinks.length > 100000) throw new Error('Diagnostic stored identity limit exceeded');
      reconciliation = { mode: 'dry-run', executable: false, epoch: meta.epoch,
        groups: planIdentityReconciliation(rows.map(r => r.payload as IncomingEvent), allLinks),
        notes: ['Proposals require review of source semantics and historical payloads; no mutation executor exists.',
          'new-event targets are stable symbolic references, not allocated UUIDs.',
          'Same provider ID observations are grouped; distinct IDs only propose separation when all stored keys are covered.',
          'Provider IDs are public adapter identifiers; raw URLs, payloads and connection details are omitted.',
          'Apply would require a fresh snapshot, revision checks, atomic identity moves and supersession/replay support.'] };
    }
    await client.query('COMMIT');
    return { sampled_at: meta.sampled_at, cursor: meta.cursor, signal_count: rows.length,
      candidate_count: candidates.length, skipped_candidates: conflicts.length, conflicts,
      ...(includePlan ? { reconciliation } : {}),
      notes: ['Read-only reconstruction from retained signals, not a recording of the previous collector cycle.',
        'Fusion time, signal order and concurrent collection can change candidates and skip counts.',
        'Identity fingerprints are SHA-256 correlation keys, not anonymization; raw URLs, titles and payloads are omitted.',
        'No events, identities, revisions or replay cursors were modified.'] };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
