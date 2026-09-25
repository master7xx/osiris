import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const server = await createServer({ configFile: false, resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } }, server: { host: '127.0.0.1', port: 4177, strictPort: true } });
await server.listen();
