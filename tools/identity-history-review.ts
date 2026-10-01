import { readFile } from 'node:fs/promises';
import { identitySnapshotInputs } from '../src/lib/identity-reconciliation-snapshot';
import { reviewHistoricalIdentities } from '../src/lib/historical-identity-review';
import { writeJsonReport } from './write-json-report';
async function main() {
  const [input, ...args] = process.argv.slice(2);
  if (!input) throw new Error('Snapshot required');
  const report = identitySnapshotInputs(JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, '')));
  const data = report.snapshotData!;
  await writeJsonReport(reviewHistoricalIdentities(data.links, data.history), args);
}
void main().catch(() => { console.error('History review failed. Check snapshot checksum, arguments and output path.'); process.exitCode = 1; });
