import { spawnSync } from 'node:child_process';
const run = spawnSync(process.execPath, ['node_modules/eslint/bin/eslint.js', 'src', 'tools', '--format', 'json'], { encoding: 'utf8', timeout: 180000, maxBuffer: 50 * 1024 * 1024 });
if (run.error || !run.stdout) { console.error('Lint inventory could not complete:', run.error?.message ?? run.stderr); process.exitCode = 1; }
else {
  const files = JSON.parse(run.stdout);
  const rules = {};
  for (const file of files) for (const message of file.messages) { const key = message.ruleId ?? 'parse'; rules[key] = (rules[key] ?? 0) + 1; }
  console.log(JSON.stringify({ files: files.length, errors: files.reduce((n, f) => n + f.errorCount, 0), warnings: files.reduce((n, f) => n + f.warningCount, 0), rules,
    largest: files.sort((a, b) => b.errorCount - a.errorCount).slice(0, 10).map(file => ({ file: file.filePath.replace(process.cwd(), ''), errors: file.errorCount })) }, null, 2));
  // Inventory existing lint debt; functional/type/build gates remain separately enforced.
}
