import { writeFile } from 'node:fs/promises';

/** Write UTF-8 directly, avoiding shell decoding/re-encoding; refuse to overwrite an existing report. */
export async function writeJsonReport(value: unknown, args = process.argv.slice(2)): Promise<void> {
  if (!args.length) { console.log(JSON.stringify(value, null, 2)); return; }
  if (args.length !== 2 || args[0] !== '--output' || !args[1].trim()) throw new Error('Usage: --output <new-report.json>');
  await writeFile(args[1], `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log('Written successfully. No database changes.');
}
