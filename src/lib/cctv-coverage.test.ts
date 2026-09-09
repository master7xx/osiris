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

  it('normalizes common country aliases and prefers country identity over overlapping boxes', () => {
    expect(normalizeCctvCountry('UK')).toBe('United Kingdom');
    expect(normalizeCctvCountry('Russian Federation')).toBe('Russia');
    expect(classifyCctvMacroRegion(camera({ country: 'Russia', lat: 43.1, lng: 131.9 }))).toBe('russia-eurasia');
    expect(classifyCctvMacroRegion(camera())).toBe('east-asia');
  });

  it('classifies feed surfaces without treating external links as streams', () => {
    expect(classifyCctvFeed(camera())).toBe('snapshot');
    expect(classifyCctvFeed(camera({ feed_url: undefined, stream_type: 'hls', stream_url: 'https://x.test/live.m3u8' }))).toBe('hls');
    expect(classifyCctvFeed(camera({ feed_url: undefined, stream_type: 'iframe', stream_url: 'https://x.test/embed' }))).toBe('iframe');
    expect(classifyCctvFeed(camera({ feed_url: undefined, stream_url: undefined, external_url: 'https://x.test/view' }))).toBe('external');
  });

  it('builds per-region provider/feed counts and strategic gap diagnostics', () => {
    const rows: CctvCoverageCamera[] = [
      camera({ id: 'occ-jp', source: 'OpenCCTV / Japan' }),
      camera({ id: 'windy-jp', source: 'Webcams provided by Windy.com', stream_type: 'iframe', stream_url: 'https://x.test/embed', feed_url: undefined }),
      camera({ id: 'tfl-1', country: 'UK', lat: 51.5, lng: -0.1, source: 'TfL' }),
      camera({ id: 'curated-1', country: 'France', lat: 48.8, lng: 2.3, source: 'curated', external_url: 'https://x.test', feed_url: undefined }),
    ];

    const snapshot = analyzeCctvCoverage(rows, { scope: 'global', requestRegions: ['all'], now: 1_700_000_000_000 });
    const eastAsia = snapshot.regions.find(region => region.id === 'east-asia');
    const europe = snapshot.regions.find(region => region.id === 'europe');

    expect(snapshot.total_cameras).toBe(4);
    expect(snapshot.countries_seen).toBe(3);
    expect(eastAsia?.provider_counts.opencctv).toBe(1);
    expect(eastAsia?.provider_counts.windy).toBe(1);
    expect(eastAsia?.feed_counts.snapshot).toBe(1);
    expect(eastAsia?.feed_counts.iframe).toBe(1);
    expect(eastAsia?.watchlist_missing).toContain('South Korea');
    expect(europe?.provider_counts.official).toBe(1);
    expect(europe?.provider_counts.curated).toBe(1);
    expect(snapshot.priority_regions.length).toBeGreaterThan(0);
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
