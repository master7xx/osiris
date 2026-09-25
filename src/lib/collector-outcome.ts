import type { Pool } from 'pg';
import type { CollectorLease } from './event-collector-lease';
import type { EventSourceHealth } from './event-sources';

/** Preserve the last successful feed time on failure; stale workers cannot overwrite health. */
export async function recordCollectorOutcome(pool: Pool, lease: CollectorLease, outcome: {
  success: boolean; error: string | null; health?: EventSourceHealth[];
}) {
  const result = await pool.query(`UPDATE osiris_events.collector SET
    last_success_at=CASE WHEN $3::boolean THEN clock_timestamp() ELSE last_success_at END,
    last_error=$4,source_health=COALESCE($5::jsonb,source_health)
    WHERE owner=$1 AND generation=$2 AND expires_at>clock_timestamp()`,
  [lease.owner, lease.generation, outcome.success, outcome.error,
    outcome.health === undefined ? null : JSON.stringify(outcome.health)]);
  return result.rowCount === 1;
}
