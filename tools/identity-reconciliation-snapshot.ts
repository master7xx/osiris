import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { identityConflictReport } from '../src/lib/identity-conflict-report';
import { createIdentitySnapshot, replayIdentitySnapshot, identitySnapshotInputs } from '../src/lib/identity-reconciliation-snapshot';

async function jsonFile(path: string) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}
async function main() {
  const [mode, output, ...inputs] = process.argv.slice(2);
  if (!output || !['export', 'replay', 'annotate'].includes(mode)) throw new Error('Usage: export OUTPUT [PREVIOUS_REPORT...] | replay OUTPUT SNAPSHOT | annotate OUTPUT SNAPSHOT PREVIOUS_REPORT...');
  let result;
  if (mode === 'replay') {
    if (inputs.length !== 1) throw new Error('One snapshot required');
    result = replayIdentitySnapshot(await jsonFile(inputs[0]));
  } else if (mode === 'annotate') {
    if (inputs.length < 2) throw new Error('Snapshot and previous report required');
    result = createIdentitySnapshot(identitySnapshotInputs(await jsonFile(inputs[0])),
      await Promise.all(inputs.slice(1).map(jsonFile)));
  } else {
    const previousReports: unknown[] = [];
    const previousIds = new Set<string>();
    for (const path of inputs) {
      const report = await jsonFile(path);
      previousReports.push(report);
      if (!Array.isArray(report.reconciliation?.groups)) throw new Error('Previous report required');
      for (const id of [...report.reconciliation.groups.map((g: { stored_event_id: string }) => g.stored_event_id),
        ...(report.reconciliation.unresolved_event_ids ?? []),
        ...(report.reconciliation.historical_pair_reviews ?? []).flatMap((h: { pair: { left_event: string; right_event: string } }) => [h.pair.left_event, h.pair.right_event])]) {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid event ID');
        previousIds.add(id);
      }
    }
    if (!process.env.EVENT_DATABASE_URL) throw new Error('Database connection required');
    const pool = new pg.Pool({ connectionString: process.env.EVENT_DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
    try { result = createIdentitySnapshot(await identityConflictReport(pool, true, { previousIds: [...previousIds] }), previousReports); }
    finally { await pool.end(); }
  }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log('Written successfully. No database changes.');
}
void main().catch(() => {
  console.error('Snapshot operation failed. Check arguments, input format, database access and that the output file does not already exist. Connection details omitted.');
  process.exitCode = 1;
});
