import { readFile, open, unlink } from 'node:fs/promises';
import pg from 'pg';
import { buildIdentitySplitPackage, checkIdentitySplitPackage } from '../src/lib/identity-split-package';
import { applyIdentityPackage, verifyIdentityPackage } from '../src/lib/apply-identity-package';

async function main() {
  const [mode, input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || !['build', 'check', 'apply', 'verify'].includes(mode) ||
      (mode === 'apply' ? extra.length !== 2 || extra[0] !== '--approve' || !/^[a-f0-9]{64}$/.test(extra[1]) : extra.length !== 0)) {
    throw new Error('Usage: build/check/verify INPUT OUTPUT | apply PACKAGE OUTPUT --approve CHECKSUM');
  }
  const value = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
  // Reserve output before any database mutation; never overwrite an existing receipt.
  const file = await open(output, 'wx', 0o600);
  let saved = false;
  try {
    let result;
    if (mode === 'build') result = buildIdentitySplitPackage(value);
    else {
      if (!process.env.EVENT_DATABASE_URL) throw new Error('Database connection required');
      const pool = new pg.Pool({ connectionString: process.env.EVENT_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
      try {
        if (mode === 'apply') result = await applyIdentityPackage(pool, value, extra[1]);
        else if (mode === 'verify') {
          result = await verifyIdentityPackage(pool, value);
          if (!result.verified) process.exitCode = 1;
        } else {
          result = await checkIdentitySplitPackage(pool, value);
          if (!result.database_matches_package) process.exitCode = 1;
        }
      } finally { await pool.end(); }
    }
    await file.writeFile(JSON.stringify(result, null, 2) + '\n', 'utf8');
    saved = true;
    console.log(mode === 'apply' ? 'Application receipt saved. Run verify before restarting the collector.' : 'Report saved. No database changes.');
  } finally {
    await file.close();
    if (!saved) await unlink(output).catch(() => {});
  }
}
void main().catch(() => {
  console.error('Operation failed. Check arguments, package integrity, preflight and database access. If apply lost its response, repeat the SAME package and approval: its database receipt prevents duplicate application. Connection details omitted.');
  process.exitCode = 1;
});
