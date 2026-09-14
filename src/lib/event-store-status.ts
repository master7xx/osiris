import type { Pool } from 'pg';
import { collectorStatusReason } from './collector-status-reason';

/** Read-only diagnostics. Catalog estimates deliberately avoid COUNT(*) scans. */
export async function eventStoreStatus(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const metadata = (await client.query('SELECT cursor,retention_floor FROM osiris_events.metadata WHERE singleton')).rows[0];
    if (!metadata) throw new Error('Event store requires migration');
    const tables = (await client.query(`SELECT c.relname AS name,
      CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint::text END AS estimated_rows,
      s.n_dead_tup::text AS estimated_dead_rows,
      pg_table_size(c.oid)::text AS table_bytes,
      pg_indexes_size(c.oid)::text AS index_bytes,
      pg_total_relation_size(c.oid)::text AS total_bytes,
      s.last_autovacuum,s.last_autoanalyze
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
      WHERE n.nspname='osiris_events' AND c.relkind='r' ORDER BY c.relname`)).rows;
    const first = (await client.query('SELECT cursor,committed_at FROM osiris_events.revisions ORDER BY cursor ASC LIMIT 1')).rows[0] ?? null;
    const last = (await client.query('SELECT cursor,committed_at FROM osiris_events.revisions ORDER BY cursor DESC LIMIT 1')).rows[0] ?? null;
    const collectorRow = (await client.query(`SELECT expires_at>clock_timestamp() AS lease_active,
      last_success_at,last_error
      FROM osiris_events.collector WHERE singleton`)).rows[0] ?? null;
    const collector = collectorRow ? {
      lease_active: collectorRow.lease_active,
      last_success_at: collectorRow.last_success_at,
      has_error: collectorRow.last_error !== null,
      ...collectorStatusReason(collectorRow.last_error),
    } : null;
    const sampledAt = (await client.query('SELECT clock_timestamp() AS sampled_at')).rows[0].sampled_at;
    await client.query('COMMIT');
    return {
      sampled_at: sampledAt, metadata, collector, first_revision: first, last_revision: last, tables,
      total_bytes: tables.reduce((sum, row) => sum + BigInt(row.total_bytes), BigInt(0)).toString(),
      notes: ['Row counts are planner/statistics estimates, not exact counts; null means no estimate.',
        'Sizes include allocated space and can vary during concurrent writes; they are not reclaimable-space estimates.',
        'Revision endpoints are ordered by replay cursor. No retention or cleanup is performed.'],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
