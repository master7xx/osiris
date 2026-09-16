import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { identityConflictReport } from '../src/lib/identity-conflict-report';
import { createIdentitySnapshot, replayIdentitySnapshot } from '../src/lib/identity-reconciliation-snapshot';

async function jsonFile(path: string) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}
async function main() {
  const [mode, output, ...inputs] = process.argv.slice(2);
  if (!output || !['export', 'replay'].includes(mode)) throw new Error('Usage: export OUTPUT [PREVIOUS_REPORT...] | replay OUTPUT SNAPSHOT');
  let result;
  if (mode === 'replay') {
    if (inputs.length !== 1) throw new Error('One snapshot required');
    result = replayIdentitySnapshot(await jsonFile(inputs[0]));
  } else {
    const previousIds = new Set<string>();
    for (const path of inputs) {
      const report = await jsonFile(path);
      if (!Array.isArray(report.reconciliation?.groups)) throw new Error('Previous report required');
      for (const id of [...report.reconciliation.groups.map((g: { stored_event_id: string }) => g.stored_event_id),
        ...(report.reconciliation.unresolved_event_ids ?? [])]) {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid event ID');
        previousIds.add(id);
      }
    }
    if (!process.env.EVENT_DATABASE_URL) throw new Error('Database connection required');
    const pool = new pg.Pool({ connectionString: process.env.EVENT_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
    try { result = createIdentitySnapshot(await identityConflictReport(pool, true, { previousIds: [...previousIds] })); }
    finally { await pool.end(); }
  }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log('Written successfully. No database changes.');
}
void main().catch(() => {
  console.error('Snapshot operation failed. Check arguments, input format, database access and that the output file does not already exist. Connection details omitted.');
  process.exitCode = 1;
});
