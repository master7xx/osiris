import { describe, expect, it } from 'vitest';
import { fallbackRequestUrl, planCctvFallback } from './adaptive-fallback';

describe('CCTV adaptive fallback', () => {
  it('does nothing for a successful non-empty response regardless of latency', () => {
    expect(planCctvFallback('http://localhost/api/cctv?region=japan', true, 1, ['japan'])).toBeNull();
  });

  it('falls back from an empty Japan result to broad Asia providers', () => {
    expect(planCctvFallback('http://localhost/api/cctv?region=japan', true, 0, ['japan'])).toEqual({
      trigger: 'empty',
      requestedRegions: ['japan'],
      fallbackRegions: ['eastasia', 'asia-live'],
    });
  });

  it('falls back after an HTTP error', () => {
    expect(planCctvFallback('http://localhost/api/cctv?region=germany', false, 0)).toEqual({
      trigger: 'http-error',
      requestedRegions: ['germany'],
      fallbackRegions: ['europe-live'],
    });
  });

  it('does not repeat a macro provider already used by coordinate routing', () => {
    expect(planCctvFallback(
      'http://localhost/api/cctv?lat=35.68&lng=139.76',
      true,
      0,
      ['japan', 'asia-live', 'asia', 'eastasia'],
    )).toBeNull();
  });

  it('does not invent a fallback for region=all or unsupported local regions', () => {
    expect(planCctvFallback('http://localhost/api/cctv?region=all', true, 0, ['japan'])).toBeNull();
    expect(planCctvFallback('http://localhost/api/cctv?region=maryland', true, 0, ['maryland'])).toBeNull();
  });

  it('rewrites the retry as an explicit macro-region request', () => {
    const plan = planCctvFallback('http://localhost/api/cctv?region=turkey&lat=39&lng=35&radius=5', true, 0)!;
    const url = new URL(fallbackRequestUrl('http://localhost/api/cctv?region=turkey&lat=39&lng=35&radius=5', plan));
    expect(url.searchParams.get('region')).toBe('westasia,asia-live,europe-live');
    expect(url.searchParams.has('lat')).toBe(false);
    expect(url.searchParams.has('lng')).toBe(false);
    expect(url.searchParams.has('radius')).toBe(false);
  });
});
