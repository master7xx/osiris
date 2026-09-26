import type { Pool } from 'pg';
import type { IncomingEvent } from './event-fusion';
import type { CollectorLease } from './event-collector-lease';
import { batches } from './collector-observations';

/** Same exact signal key and last-write-wins semantics as sequential upserts. */
export function signalBatchRows(signals: IncomingEvent[]) {
  const rows = new Map<string, { id: string; payload: IncomingEvent }>();
  for (const signal of signals) {
    const id = JSON.stringify([signal.evidence.map(item => item.source_id).sort(), signal.id]);
    rows.set(id, { id, payload: signal });
  }
  return [...rows.values()];
}

/** One atomic observation transaction, bounded SQL batches and database-time fencing. */
export async function persistCollectorSignals(pool: Pool, lease: CollectorLease, signals: IncomingEvent[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('SELECT cursor FROM osiris_events.metadata WHERE singleton FOR UPDATE');
    const renew = async () => {
      const result = await client.query(`UPDATE osiris_events.collector
        SET expires_at=clock_timestamp()+interval '120 seconds'
        WHERE owner=$1 AND generation=$2 AND expires_at>clock_timestamp()`, [lease.owner, lease.generation]);
      if (!result.rowCount) throw new Error('Collector lease expired');
    };
    // Validate even an empty cycle before the existing transient-signal expiry.
    await renew();
    for (const batch of batches(signals, 100)) {
      await renew();
      await client.query(`INSERT INTO osiris_events.signals (id,payload)
        SELECT id,payload FROM jsonb_to_recordset($1::jsonb) AS batch(id text,payload jsonb)
        ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,observed_at=clock_timestamp()`,
      [JSON.stringify(signalBatchRows(batch))]);
    }
    // Existing 48-hour transient cache policy; durable event/history tables are untouched.
    await client.query("DELETE FROM osiris_events.signals WHERE observed_at < clock_timestamp()-interval '48 hours'");
    await renew();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
