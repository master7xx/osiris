import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (!process.env.EVENT_TEST_DATABASE_URL) throw new Error('EVENT_TEST_DATABASE_URL must point to a dedicated disposable database ending in _test');
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)), 'run', 'src/lib/durable-event-store.test.ts'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
