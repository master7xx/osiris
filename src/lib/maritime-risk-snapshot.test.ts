import { afterEach, expect, it, vi } from 'vitest';
import { noteMaritimeRisk, readMaritimeRisk } from './maritime-risk-snapshot';
import { clearSourceCache } from './sourceCache';
import { GET } from '../app/api/markets/route';
afterEach(() => { globalThis.__OSIRIS_MARITIME_RISK__ = undefined; clearSourceCache(); vi.unstubAllGlobals(); });
it('distinguishes cold, current and expired context without renewing its age', () => {
  expect(readMaritimeRisk().state).toBe('unavailable');
  const rows = [{ name: 'Strait of Hormuz', risk: 'HIGH' }];
  noteMaritimeRisk(rows, 1000);
  rows[0].risk = 'LOW';
  expect(readMaritimeRisk(121000).chokepoints[0].risk).toBe('HIGH');
  expect(readMaritimeRisk(121001)).toMatchObject({ state: 'stale', observed_at: new Date(1000).toISOString(), chokepoints: [] });
  noteMaritimeRisk([], 122000);
  expect(readMaritimeRisk(122000)).toMatchObject({ state: 'cached', chokepoints: [] });
});
it('returns maritime context with quotes without fetching internal maritime', async () => {
  clearSourceCache();
  const fetcher = vi.fn(async (url: string) => { expect(new URL(url).hostname).not.toBe('localhost'); return Response.json({ chart: { result: [] } }); });
  vi.stubGlobal('fetch', fetcher);
  noteMaritimeRisk([{ name: 'Strait of Hormuz', risk: 'HIGH' }]);
  const result = await (await GET()).json();
  expect(result.scm_snapshot.state).toBe('cached');
  expect(result.scm_alerts).toHaveLength(1);
  expect(fetcher.mock.calls.every(args => !String(args[0]).includes('/api/maritime'))).toBe(true);
});
