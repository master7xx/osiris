import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSourceCache } from '@/lib/sourceCache';
import { fetchRussiaBelarusOpenCctvCameras } from './opencctv';

const upstream = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stealthFetch', () => ({ stealthFetch: upstream }));

describe('Russia and Belarus OpenCCTV discovery', () => {
  beforeEach(() => { clearSourceCache(); upstream.mockReset(); });

  it('shares the index, limits results by provider country and deduplicates overlapping samples', async () => {
    const rows = [
      { id: 'ru', country: 'RU', lat: 55.75, lng: 37.62 },
      { id: 'by', country: 'BY', lat: 53.9, lng: 27.56 },
      { id: 'pl', country: 'PL', lat: 52.3, lng: 23.5 },
      { id: 'far', country: 'RU', lat: 53.0, lng: 158.6 },
    ];
    upstream.mockImplementation(async (url: string, options?: { body?: string }) => {
      if (url.endsWith('/markers')) return new Response(JSON.stringify({ ids: rows.map(r => r.id), lats: rows.map(r => r.lat), lngs: rows.map(r => r.lng) }));
      const ids = JSON.parse(options!.body!).ids as string[];
      return new Response(JSON.stringify(rows.filter(r => ids.includes(r.id)).map(r => ({ ...r, feed_type: 'image', feed_url: `https://example.org/${r.id}.jpg`, active: 1 }))));
    });
    const cameras = await fetchRussiaBelarusOpenCctvCameras();
    expect(cameras.map(c => c.id).sort()).toEqual(['occ-by', 'occ-far', 'occ-ru']);
    expect(upstream.mock.calls.filter(([url]) => String(url).endsWith('/markers'))).toHaveLength(1);
    await fetchRussiaBelarusOpenCctvCameras();
    expect(upstream).toHaveBeenCalledTimes(3);
  });
});
