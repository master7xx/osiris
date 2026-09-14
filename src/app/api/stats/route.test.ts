import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { analyzeCctvCoverage, noteGlobalCctvCoverage, resetCctvCoverageForTests } from '@/lib/cctv-coverage';

afterEach(() => { vi.unstubAllGlobals(); resetCctvCoverageForTests(); });
function mockFeeds() {
  const payloads: Record<string, unknown> = {
    flights: { commercial_flights: [1, 2], military_flights: [3] },
    satellites: { satellites: [1, 2] },
    weather: { events: [1] }, infrastructure: { infrastructure: [1] }, gdelt: { events: [1, 2] },
  };
  const fetcher = vi.fn(async (url: string) => Response.json(payloads[new URL(url).pathname.split('/').pop()!]));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
it('returns an unknown camera count without requesting a cold camera catalog', async () => {
  const fetcher = mockFeeds();
  const response = await GET(new Request('http://localhost:3000/api/stats'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const result = await response.json();
  expect(result.stats).toEqual({ flights: 3, sats: 2, cctv: null, weather: 1, nuclear: 1, incidents: 2 });
  expect(result.cctv_snapshot).toMatchObject({ state: 'unavailable', observed_at: null });
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(fetcher.mock.calls.some(([url]) => new URL(url).pathname === '/api/cctv')).toBe(false);
});
it('uses global snapshot count and original observation time across stats requests', async () => {
  mockFeeds();
  noteGlobalCctvCoverage(analyzeCctvCoverage([{ id: 'a' }, { id: 'b' }], { scope: 'global', now: 1000 }));
  noteGlobalCctvCoverage(analyzeCctvCoverage([{ id: 'regional' }], { scope: 'request', now: 2000 }));
  for (let i = 0; i < 3; i++) {
    const result = await (await GET(new Request('http://localhost:3000/api/stats'))).json();
    expect(result.stats.cctv).toBe(2);
    expect(result.cctv_snapshot).toEqual({ state: 'cached', observed_at: new Date(1000).toISOString(), scope: 'global' });
  }
});
it('distinguishes a known empty catalog from no snapshot and sees later updates', async () => {
  mockFeeds();
  noteGlobalCctvCoverage(analyzeCctvCoverage([], { scope: 'global', now: 1000 }));
  expect((await (await GET(new Request('http://localhost/api/stats'))).json()).stats.cctv).toBe(0);
  noteGlobalCctvCoverage(analyzeCctvCoverage([{ id: 'new' }], { scope: 'global', now: 2000 }));
  expect((await (await GET(new Request('http://localhost/api/stats'))).json()).stats.cctv).toBe(1);
});
