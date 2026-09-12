import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { pathToFileURL } from 'node:url';

export async function migrateEvents(pool) {
  const sql = (await readFile(new URL('../migrations/events/001_initial.sql', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(718234901)");
    await client.query('CREATE SCHEMA IF NOT EXISTS osiris_events');
    await client.query('CREATE TABLE IF NOT EXISTS osiris_events.migrations (version integer PRIMARY KEY, checksum text NOT NULL)');
    const existing = await client.query('SELECT checksum FROM osiris_events.migrations WHERE version = 1');
    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum) throw new Error('Event migration checksum mismatch');
    } else {
      await client.query(sql);
      await client.query('INSERT INTO osiris_events.metadata (epoch) VALUES ($1)', [randomUUID()]);
      await client.query('INSERT INTO osiris_events.migrations (version, checksum) VALUES (1, $1)', [checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.EVENT_DATABASE_URL) throw new Error('EVENT_DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: process.env.EVENT_DATABASE_URL, connectionTimeoutMillis: 10000 });
  try { await migrateEvents(pool); console.log('Event migrations applied.'); } finally { await pool.end(); }
}
