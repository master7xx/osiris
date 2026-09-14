import { afterEach, expect, it, vi } from 'vitest';
import { CELESTRAK_GROUPS, fetchCelesTrakGroup } from './celestrak-groups';
const tle = 'ISS\n1 25544U 98067A   26256.50000000  .00015505  00000-0  27885-3 0  9997\n2 25544  51.6402 189.7042 0004381 334.8091 106.8778 15.50091157455243';
afterEach(() => vi.unstubAllGlobals());
it('does not request the confirmed invalid tle-new group', () => {
  expect(CELESTRAK_GROUPS.some(url => new URL(url).searchParams.get('GROUP') === 'tle-new')).toBe(false);
});
it('retains successful group results alongside a named 404', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new URL(url).searchParams.get('GROUP') === 'broken'
    ? new Response('Not found', { status: 404 }) : new Response(tle)));
  const results = await Promise.all(['stations', 'broken'].map(group => fetchCelesTrakGroup(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`)));
  expect(results[0].satellites).toHaveLength(1);
  expect(results[0].health).toMatchObject({ group: 'stations', state: 'ok', records: 1, http_status: 200 });
  expect(results[1].health).toMatchObject({ group: 'broken', state: 'error', records: 0, http_status: 404 });
});
it('treats HTTP 200 error text as failure, not a healthy empty catalog', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Invalid query: GROUP not found')));
  const result = await fetchCelesTrakGroup('https://celestrak.org/NORAD/elements/gp.php?GROUP=bad');
  expect(result.health).toMatchObject({ state: 'error', http_status: 200, error: 'No valid TLE records' });
});
it('identifies supplemental files and transport failures', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
  const result = await fetchCelesTrakGroup('https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink');
  expect(result.health).toMatchObject({ group: 'supplemental:starlink', state: 'error', error: 'timeout' });
  expect(result.health.http_status).toBeUndefined();
});
