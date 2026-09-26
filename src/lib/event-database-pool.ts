import { Pool, type PoolConfig } from 'pg';

/** pg removes a failed idle client itself; handle its pool event without crashing the process. */
export function createEventDatabasePool(options: PoolConfig, role: 'web' | 'collector') {
  const pool = new Pool(options);
  pool.on('error', () => {
    // Do not log the Error/client objects: they may contain connection details.
    console.error(`[events:${role}] Idle database connection lost; the next operation will reconnect.`);
  });
  return pool;
}
