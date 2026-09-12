import type { Pool } from 'pg';
export interface CollectorLease { owner: string; generation: string }
export async function acquireCollectorLease(pool: Pool, owner: string): Promise<CollectorLease | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('SELECT cursor FROM osiris_events.metadata WHERE singleton FOR UPDATE');
    const result = await client.query(`INSERT INTO osiris_events.collector (owner,generation,expires_at) VALUES ($1,1,clock_timestamp()+interval '120 seconds')
      ON CONFLICT (singleton) DO UPDATE SET owner=EXCLUDED.owner,
      generation=CASE WHEN osiris_events.collector.owner=EXCLUDED.owner AND osiris_events.collector.expires_at>clock_timestamp() THEN osiris_events.collector.generation ELSE osiris_events.collector.generation+1 END,
      expires_at=EXCLUDED.expires_at
      WHERE osiris_events.collector.owner=EXCLUDED.owner OR osiris_events.collector.expires_at<=clock_timestamp()
      RETURNING owner,generation`, [owner]);
    await client.query('COMMIT'); return result.rows[0] ?? null;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function releaseCollectorLease(pool: Pool, lease: CollectorLease) {
  await pool.query('UPDATE osiris_events.collector SET expires_at=clock_timestamp() WHERE owner=$1 AND generation=$2', [lease.owner, lease.generation]);
}
