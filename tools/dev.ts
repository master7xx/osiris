import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function devCommands(env: Record<string, string | undefined>, args: string[]) {
  const commands = [{ name: 'web', args: [require.resolve('next/dist/bin/next'), 'dev', ...args] }];
  if (env.EVENT_READ_MODE === 'durable') {
    if (!env.EVENT_DATABASE_URL?.trim()) throw new Error('Durable mode requires EVENT_DATABASE_URL in .env.local or the environment');
    commands.push({ name: 'collector', args: ['--import', 'tsx', 'tools/collect-events.ts'] });
  }
  return commands;
}

/** Own both process trees; failure of either child stops the whole dev session. */
export async function supervise(commands: { name: string; args: string[] }[], env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const children: ChildProcess[] = [];
  let stopping = false;
  let exitCode = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const killTree = (child: ChildProcess, force: boolean) => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      // Node's child.kill() alone does not terminate Next's worker descendants.
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.on('error', () => child.kill());
    } else {
      try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error('[dev] Could not stop process group'); }
    }
  };
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    for (const child of children) killTree(child, false);
    timer = setTimeout(() => { for (const child of children) killTree(child, true); }, 5000);
    timer.unref();
  };
  const interrupt = () => stop(0);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  signal?.addEventListener('abort', interrupt, { once: true });
  try {
    if (signal?.aborted) return 0;
    const completions = commands.map(command => {
      console.log(`[dev] Starting ${command.name}`);
      const child = spawn(process.execPath, command.args, { env, stdio: 'inherit', detached: process.platform !== 'win32' });
      children.push(child);
      return new Promise<void>(resolve => {
        child.once('error', () => { console.error(`[dev] Failed to start ${command.name}`); stop(1); });
        child.once('exit', (code, childSignal) => {
          if (!stopping) {
            console.error(`[dev] ${command.name} exited (${childSignal ?? code}); stopping session`);
            stop(code || 1);
          }
        });
        child.once('close', () => resolve());
      });
    });
    await Promise.all(completions);
    return exitCode;
  } finally {
    if (timer) clearTimeout(timer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    signal?.removeEventListener('abort', interrupt);
  }
}

async function main() {
  if (process.argv.slice(2).some(arg => arg === '--help' || arg === '-h')) {
    const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--help'], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
    return;
  }
  // Use Next's own loader and precedence, including .env.development.local and .env.local.
  const nextRequire = createRequire(require.resolve('next/package.json'));
  nextRequire('@next/env').loadEnvConfig(process.cwd(), true);
  const commands = devCommands(process.env, process.argv.slice(2));
  if (commands.length === 1) console.log('[dev] Snapshot mode: collector not required');
  process.exitCode = await supervise(commands, process.env);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => { console.error(`[dev] ${error instanceof Error ? error.message : 'Startup failed'}`); process.exitCode = 1; });
}
