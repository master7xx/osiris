import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyCctvProvider,
  getCctvProviderHealth,
  noteCctvProviderResponse,
  noteCctvProviderScope,
  resetCctvProviderHealthForTests,
} from './cctv-provider-health';

beforeEach(() => resetCctvProviderHealthForTests());

describe('CCTV provider health', () => {
  it('tracks a healthy provider scope without treating duration as health', () => {
    noteCctvProviderScope('opencctv', 'europe', {
      state: 'healthy',
      cameras: 420,
      durationMs: 25_000,
      now: 1_000,
    });
    noteCctvProviderResponse([
      { id: 'occ-a', source: 'OpenCCTV / Example' },
      { id: 'occ-b', source: 'OpenCCTV' },
    ], 2_000);

    const open = getCctvProviderHealth().find(provider => provider.id === 'opencctv');
    expect(open).toMatchObject({
      state: 'healthy',
      enabled: true,
      cameras: 420,
      response_cameras: 2,
      duration_ms: 25_000,
    });
  });

  it('marks a provider partial when one scope fails and another succeeds', () => {
    noteCctvProviderScope('opencctv', 'europe', {
      state: 'healthy', cameras: 200, durationMs: 500, now: 1_000,
    });
    noteCctvProviderScope('opencctv', 'westasia', {
      state: 'error', cameras: 0, durationMs: 700, error: 'batch HTTP 503', now: 2_000,
    });

    const open = getCctvProviderHealth().find(provider => provider.id === 'opencctv');
    expect(open?.state).toBe('partial');
    expect(open?.last_error).toBe('batch HTTP 503');
    expect(open?.scopes).toHaveLength(2);
  });

  it('reports Windy disabled when the optional API key is unavailable', () => {
    noteCctvProviderScope('windy', 'europe', {
      state: 'disabled', enabled: false, cameras: 0, now: 1_000,
    });

    const windy = getCctvProviderHealth().find(provider => provider.id === 'windy');
    expect(windy).toMatchObject({ state: 'disabled', enabled: false, response_cameras: 0 });
  });

  it('classifies response cameras into global, curated and official groups', () => {
    const rows = [
      { id: 'occ-1', source: 'OpenCCTV / operator' },
      { id: 'windy-2', source: 'Webcams provided by Windy.com' },
      { id: 'sky-3', source: 'SkylineWebcams' },
      { id: 'yt-4', source: 'YouTube Live' },
      { id: 'tfl-5', source: 'TfL' },
    ];

    expect(rows.map(classifyCctvProvider)).toEqual([
      'opencctv', 'windy', 'curated', 'curated', 'official',
    ]);

    noteCctvProviderResponse(rows, 10_000);
    const health = Object.fromEntries(getCctvProviderHealth().map(provider => [provider.id, provider]));
    expect(health.opencctv.response_cameras).toBe(1);
    expect(health.windy.response_cameras).toBe(1);
    expect(health.curated.response_cameras).toBe(2);
    expect(health.official.response_cameras).toBe(1);
    expect(health.official.state).toBe('healthy');
    expect(health.curated.state).toBe('healthy');
  });
});
