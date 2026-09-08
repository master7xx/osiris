import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const major = Number(process.versions.node.split('.')[0]);
const checks = [
  ['platform', process.platform === 'win32' ? 'Windows native' : process.platform, true],
  ['Node.js', process.version, major >= 20],
];

try {
  await access('package.json', constants.R_OK);
  checks.push(['working directory', 'package.json found', true]);
} catch {
  checks.push(['working directory', 'run this command from the OSIRIS repository root', false]);
}

for (const [name, value, ok] of checks) {
  console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}: ${value}`);
}

console.log(process.env.SCANNER_URL
  ? `[INFO] scanner backend: ${process.env.SCANNER_URL}`
  : '[INFO] scanner backend: disabled (SCANNER_URL is not set)');
console.log(process.env.UMAMI_BASE_URL
  ? `[INFO] analytics: ${process.env.UMAMI_BASE_URL}`
  : '[INFO] analytics: disabled (recommended for native development)');

if (checks.some(([, , ok]) => !ok)) process.exitCode = 1;
