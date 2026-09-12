import { Pool } from 'pg';
declare global {
  var __OSIRIS_EVENT_DATABASE__: Pool | undefined;
}
export function eventDatabase() {
  if (!process.env.EVENT_DATABASE_URL) return null;
  return globalThis.__OSIRIS_EVENT_DATABASE__ ??= new Pool({ connectionString: process.env.EVENT_DATABASE_URL, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 30000 });
}
