import { writeJsonReport } from './write-json-report';
import pg from 'pg';
import { identityConflictReport } from '../src/lib/identity-conflict-report';

async function main() {
  if (!process.env.EVENT_DATABASE_URL) throw new Error('EVENT_DATABASE_URL is required; load .env.local with --env-file');
  const pool = new pg.Pool({ connectionString: process.env.EVENT_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  try { await writeJsonReport(await identityConflictReport(pool)); }
  finally { await pool.end(); }
}
void main().catch(() => {
  // Connection errors can include host/user details; do not print credentials.
  console.error('Identity conflict report failed. Check database access, migrations and a new writable output path. No database changes were requested.');
  process.exitCode = 1;
});
