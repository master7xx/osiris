import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const port = 3107;
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), OSIRIS_DEBUG: '1' },
    windowsHide: true,
  },
);

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

async function stop() {
  if (!child.killed) child.kill();
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(3000),
  ]);
}

try {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js exited early with code ${child.exitCode}\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1500),
        cache: 'no-store',
      });
      if (response.ok) {
        console.log(`[OK] Windows native runtime smoke test: /api/health -> ${response.status}`);
        process.exitCode = 0;
        break;
      }
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  if (process.exitCode !== 0) throw lastError || new Error('server did not become ready');
} catch (error) {
  console.error('[FAIL] Windows native runtime smoke test');
  console.error(error instanceof Error ? error.message : error);
  console.error(output);
  process.exitCode = 1;
} finally {
  await stop();
}
