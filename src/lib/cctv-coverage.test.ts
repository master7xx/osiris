import { beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeCctvCoverage,
  classifyCctvFeed,
  classifyCctvMacroRegion,
  getGlobalCctvCoverage,
  normalizeCctvCountry,
  noteGlobalCctvCoverage,
  resetCctvCoverageForTests,
  type CctvCoverageCamera,
} from './cctv-coverage';

const camera = (overrides: Partial<CctvCoverageCamera> = {}): CctvCoverageCamera => ({
  id: 'cam-1',
  lat: 35.6762,
  lng: 139.6503,
  country: 'Japan',
  source: 'OpenCCTV / test',
  feed_url: 'https://example.test/cam.jpg',
  ...overrides,
});

describe('CCTV global coverage analysis', () => {
  beforeEach(() => resetCctvCoverageForTests());

  it('normalizes common aliases and preserves country-first macro classification', () => {
    expect(normalizeCctvCountry('UK')).toBe('United Kingdom');
    expect(normalizeCctvCountry('Russian Federation')).toBe('Russia');
    expect(normalizeCctvCountry('BY')).toBe('Belarus');
    expect(normalizeCctvCountry('Turkmenia')).toBe('Turkmenistan');
    expect(classifyCctvMacroRegion(camera({ country: 'Russia', lat: 43.1, lng: 131.9 }))).toBe('russia-eurasia');
    expect(classifyCctvMacroRegion(camera({ country: 'Belarus', lat: 53.9, lng: 27.6 }))).toBe('europe');
    expect(classifyCctvMacroRegion(camera())).toBe('east-asia');
  });

  it('classifies feed surfaces without treating external links as streams', () => {
    expect(classifyCctvFeed(camera())).toBe('snapshot');
    expect(classifyCctvFeed(camera({ feed_url: undefined, stream_type: 'hls', stream_url: 'https://x.test/live.m3u8' }))).toBe('hls');
    expect(classifyCctvFeed(camera({ feed_url: undefined, stream_type: 'iframe', stream_url: 'https://x.test/embed' }))).toBe('iframe');
    expect(classifyCctvFeed(camera({ feed_url: undefined, stream_url: undefined, external_url: 'https://x.test/view' }))).toBe('external');
  });

  it('keeps worldwide coverage statistics but scores gaps only for target countries', () => {
    const rows: CctvCoverageCamera[] = [
      camera({ id: 'occ-jp', source: 'OpenCCTV / Japan' }),
      camera({ id: 'windy-jp', source: 'Webcams provided by Windy.com', stream_type: 'iframe', stream_url: 'https://x.test/embed', feed_url: undefined }),
      camera({ id: 'tfl-1', country: 'UK', lat: 51.5, lng: -0.1, source: 'TfL' }),
      camera({ id: 'pl-1', country: 'Poland', lat: 52.2, lng: 21.0, source: 'Official Poland' }),
      camera({ id: 'ru-1', country: 'Russia', lat: 55.75, lng: 37.62, source: 'OpenCCTV / Russia' }),
    ];

    const snapshot = analyzeCctvCoverage(rows, { scope: 'global', requestRegions: ['all'], now: 1_700_000_000_000 });
    const eastAsia = snapshot.regions.find(region => region.id === 'east-asia');
    const europe = snapshot.regions.find(region => region.id === 'europe');
    const eurasia = snapshot.regions.find(region => region.id === 'russia-eurasia');

    expect(snapshot.total_cameras).toBe(5);
    expect(snapshot.countries_seen).toBe(4);
    expect(eastAsia?.provider_counts.opencctv).toBe(1);
    expect(eastAsia?.provider_counts.windy).toBe(1);
    expect(eastAsia?.watchlist_total).toBe(0);
    expect(eastAsia?.gap_score).toBe(0);
    expect(europe?.watchlist_missing).toContain('Belarus');
    expect(europe?.watchlist_weak).toContain('Poland');
    expect(eurasia?.watchlist_weak).toContain('Russia');
    expect(snapshot.priority_regions).toEqual(expect.arrayContaining(['europe', 'russia-eurasia']));
    expect(snapshot.priority_regions).not.toContain('east-asia');
  });

  it('orders country diagnostics by the explicit implementation tiers', () => {
    const snapshot = analyzeCctvCoverage([
      camera({ id: 'pl-1', country: 'Poland', lat: 52.2, lng: 21.0 }),
      camera({ id: 'ru-1', country: 'Russia', lat: 55.75, lng: 37.62 }),
      camera({ id: 'ua-1', country: 'Ukraine', lat: 50.45, lng: 30.52 }),
      camera({ id: 'am-1', country: 'Armenia', lat: 40.18, lng: 44.51 }),
    ]);

    expect(snapshot.priority_countries.slice(0, 3).map(row => [row.country, row.tier, row.status])).toEqual([
      ['Belarus', 1, 'missing'],
      ['Poland', 1, 'weak'],
      ['Russia', 1, 'weak'],
    ]);

    const firstTier2 = snapshot.priority_countries.findIndex(row => row.tier === 2);
    const firstTier3 = snapshot.priority_countries.findIndex(row => row.tier === 3);
    expect(firstTier2).toBeGreaterThan(2);
    expect(firstTier3).toBeGreaterThan(firstTier2);
  });

  it('does not generate implementation priority for frozen non-target regions', () => {
    const snapshot = analyzeCctvCoverage([
      camera({ country: 'Japan' }),
      camera({ country: 'Brazil', lat: -23.55, lng: -46.63 }),
      camera({ country: 'Australia', lat: -33.86, lng: 151.2 }),
    ]);

    expect(snapshot.regions.find(region => region.id === 'east-asia')?.gap_score).toBe(0);
    expect(snapshot.regions.find(region => region.id === 'latam-caribbean')?.gap_score).toBe(0);
    expect(snapshot.regions.find(region => region.id === 'oceania')?.gap_score).toBe(0);
    expect(snapshot.priority_regions.every(region => region === 'europe' || region === 'russia-eurasia')).toBe(true);
  });

  it('flags only cross-source coordinate collisions as suspected duplicates', () => {
    const snapshot = analyzeCctvCoverage([
      camera({ id: 'occ-1', source: 'OpenCCTV / A', lat: 35.1001, lng: 139.1001 }),
      camera({ id: 'windy-1', source: 'Webcams provided by Windy.com', lat: 35.1002, lng: 139.1002 }),
      camera({ id: 'occ-2', source: 'OpenCCTV / A', lat: 36.2, lng: 140.2 }),
    ]);

    expect(snapshot.suspected_duplicates).toBe(1);
    expect(snapshot.regions.find(region => region.id === 'east-asia')?.suspected_duplicates).toBe(1);
  });

  it('stores only global snapshots for reuse after viewport requests', () => {
    const local = analyzeCctvCoverage([camera()], { scope: 'request' });
    noteGlobalCctvCoverage(local);
    expect(getGlobalCctvCoverage()).toBeUndefined();

    const global = analyzeCctvCoverage([camera()], { scope: 'global' });
    noteGlobalCctvCoverage(global);
    expect(getGlobalCctvCoverage()?.scope).toBe('global');
    expect(getGlobalCctvCoverage()?.total_cameras).toBe(1);
  });
});
