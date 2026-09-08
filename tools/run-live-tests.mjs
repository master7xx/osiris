import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npm, ['vitest', 'run'], {
  stdio: 'inherit',
  env: { ...process.env, RUN_LIVE_TESTS: '1' },
  shell: false,
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => {
  console.error('[OSIRIS] Unable to start Vitest:', error.message);
  process.exit(1);
});
