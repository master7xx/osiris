import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const dev = process.argv.includes('--dev');
const port = dev ? 3108 : 3107;
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', dev ? 'dev' : 'start', '-H', '127.0.0.1', '-p', String(port)],
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
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else if (!child.killed) child.kill();
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(3000),
  ]);
}

try {
  let lastError;
  for (let attempt = 0; attempt < (dev ? 100 : 40); attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js exited early with code ${child.exitCode}\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1500),
        cache: 'no-store',
      });
      if (response.ok) {
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Health returned non-JSON');
        const health = await response.json();
        if (health.status !== 'operational') throw new Error('Unexpected health payload');
        const sync = await fetch(`http://127.0.0.1:${port}/api/events/sync`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
        if (!sync.ok || !sync.headers.get('content-type')?.includes('application/json')) throw new Error(`Sync returned ${sync.status} or non-JSON`);
        const state = await sync.json();
        if (state.version !== 1 || !['snapshot', 'durable'].includes(state.mode)) throw new Error('Unexpected sync payload');
        const diagnostics = await fetch(`http://127.0.0.1:${port}/api/cctv/diagnostics?id=runtime-smoke-unknown`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
        if (!diagnostics.ok || !diagnostics.headers.get('content-type')?.includes('application/json')) throw new Error(`Camera diagnostics returned ${diagnostics.status} or non-JSON`);
        const camera = await diagnostics.json();
        if (camera.checks?.length !== 1 || camera.checks[0].id !== 'runtime-smoke-unknown' || camera.checks[0].state !== 'UNKNOWN') throw new Error('Unexpected camera diagnostic payload');
        console.log(`[OK] Windows ${dev ? 'development' : 'production'} routing: health, sync and camera diagnostics return JSON`);
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
