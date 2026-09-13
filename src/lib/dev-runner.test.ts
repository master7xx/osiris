import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { devCommands, supervise } from '../../tools/dev';

const fixture = `const fs = require('node:fs');
fs.writeFileSync(process.env.DEV_TEST_PID, String(process.pid));
setInterval(() => {}, 1000);`;
async function waitForPid(path: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { const pid = Number(await readFile(path, 'utf8')); if (pid) return pid; } catch { /* Child not ready. */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Child did not start');
}

describe('combined development session', () => {
  it('starts only web in snapshot mode and forwards CLI arguments', () => {
    const commands = devCommands({ EVENT_DATABASE_URL: 'configured-but-not-durable' }, ['--port', '3001']);
    expect(commands).toHaveLength(1);
    expect(commands[0].args.slice(-3)).toEqual(['dev', '--port', '3001']);
  });
  it('starts a collector only with a configured durable database', () => {
    const commands = devCommands({ EVENT_READ_MODE: 'durable', EVENT_DATABASE_URL: 'configured' }, ['--port', '3001']);
    expect(commands.map(command => command.name)).toEqual(['web', 'collector']);
    expect(commands[1].args).not.toContain('--port');
    expect(() => devCommands({ EVENT_READ_MODE: 'durable' }, [])).toThrow('EVENT_DATABASE_URL');
  });
  it('loads durable mode from .env.local and fails before spawning without credentials', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.dev-runner-test-'));
    try {
      await writeFile(join(dir, '.env.local'), 'EVENT_READ_MODE=durable\n');
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development' };
      delete env.EVENT_READ_MODE;
      delete env.EVENT_DATABASE_URL;
      delete env.__NEXT_PROCESSED_ENV;
      const require = createRequire(import.meta.url);
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, join(process.cwd(), 'tools/dev.ts')], {
        cwd: dir, env, encoding: 'utf8', timeout: 10000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Durable mode requires EVENT_DATABASE_URL');
      expect(result.stdout).not.toContain('[dev] Starting');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('stops a running peer and preserves the failing child exit code', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.dev-runner-test-'));
    const path = join(dir, 'pid');
    try {
      const code = await supervise([
        { name: 'peer', args: ['-e', fixture] },
        { name: 'failure', args: ['-e', `const fs = require('node:fs'); setInterval(() => { if(fs.existsSync(process.env.DEV_TEST_PID)) process.exit(7); }, 25);`] },
      ], { ...process.env, DEV_TEST_PID: path });
      expect(code).toBe(7);
      const pid = Number(await readFile(path, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('stops children on requested shutdown without reporting a failure', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.dev-runner-test-'));
    const path = join(dir, 'pid');
    const controller = new AbortController();
    const done = supervise([{ name: 'peer', args: ['-e', fixture] }], { ...process.env, DEV_TEST_PID: path }, controller.signal);
    try {
      const pid = await waitForPid(path);
      controller.abort();
      expect(await done).toBe(0);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort();
      await done;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
