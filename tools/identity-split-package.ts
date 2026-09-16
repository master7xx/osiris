import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { buildIdentitySplitPackage, checkIdentitySplitPackage } from '../src/lib/identity-split-package';

async function main() {
  const [mode, input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || !['build', 'check'].includes(mode)) throw new Error('Usage: build SNAPSHOT OUTPUT | check PACKAGE OUTPUT');
  const value = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
  let result;
  if (mode === 'build') result = buildIdentitySplitPackage(value);
  else {
    if (!process.env.EVENT_DATABASE_URL) throw new Error('Database connection required');
    const pool = new pg.Pool({ connectionString: process.env.EVENT_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
    try { result = await checkIdentitySplitPackage(pool, value); }
    finally { await pool.end(); }
  }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log('Written successfully. No database changes.');
}
void main().catch(() => {
  console.error('Split package operation failed. Check arguments, file integrity, output filename and database access. Connection details omitted.');
  process.exitCode = 1;
});
