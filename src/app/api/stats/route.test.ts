import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());
it('aggregates large routes without Next fetch-cache insertion', async () => {
  const payloads: Record<string, unknown> = {
    flights: { commercial_flights: [1, 2], military_flights: [3] },
    satellites: { satellites: [1, 2] }, cctv: { cameras: [1, 2, 3, 4] },
    weather: { events: [1] }, infrastructure: { infrastructure: [1] }, gdelt: { events: [1, 2] },
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const name = new URL(url).pathname.split('/').pop()!;
    if (['flights', 'satellites', 'cctv'].includes(name)) {
      expect(init?.cache).toBe('no-store');
      expect(init).not.toHaveProperty('next');
    }
    return Response.json(payloads[name]);
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await GET(new Request('http://localhost:3000/api/stats'));
  expect(response.status).toBe(200);
  expect((await response.json()).stats).toEqual({ flights: 3, sats: 2, cctv: 4, weather: 1, nuclear: 1, incidents: 2 });
  expect(fetcher).toHaveBeenCalledTimes(6);
});
