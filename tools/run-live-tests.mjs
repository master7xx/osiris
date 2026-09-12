import { spawn } from 'node:child_process';

import { fileURLToPath } from 'node:url';
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const child = spawn(process.execPath, [vitest, 'run'], {
  stdio: 'inherit',
  env: { ...process.env, RUN_LIVE_TESTS: '1' },
  shell: false,
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => {
  console.error('[OSIRIS] Unable to start Vitest:', error.message);
  process.exit(1);
});
