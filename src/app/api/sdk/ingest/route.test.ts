import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it('accepts zero coordinates and rejects out-of-range SDK positions', async () => {
  vi.stubEnv('SDK_INGEST_KEY', 'test-only');
  const { POST } = await import('./route');
  const request = new NextRequest('http://localhost/api/sdk/ingest', { method: 'POST', body: JSON.stringify({ apiKey: 'test-only', source: 'test', entities: [
    { id: 'zero', position: { lat: 0, lng: 0 } }, { id: 'bad', position: { lat: 91, lng: 0 } }, null,
  ] }) });
  const body = await (await POST(request)).json();
  expect(body.accepted).toBe(1); expect(body.rejected).toBe(2);
});
