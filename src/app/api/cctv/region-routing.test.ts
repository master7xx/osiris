import { describe, expect, it } from 'vitest';
import { cctvMacroRegionForViewport, routeCctvViewportUrl } from './region-routing';

describe('cctvMacroRegionForViewport', () => {
  it('routes European Russia, Siberia and the Russian Far East to westasia', () => {
    expect(cctvMacroRegionForViewport(55.7558, 37.6173)).toBe('westasia'); // Moscow
    expect(cctvMacroRegionForViewport(55.0084, 82.9357)).toBe('westasia'); // Novosibirsk
    expect(cctvMacroRegionForViewport(62.0355, 129.6755)).toBe('westasia'); // Yakutsk
    expect(cctvMacroRegionForViewport(53.037, 158.6559)).toBe('westasia'); // Kamchatka
  });

  it('routes Australia and Pacific gaps to the broad australia/Oceania source', () => {
    expect(cctvMacroRegionForViewport(-33.8688, 151.2093)).toBe('australia'); // Sydney
    expect(cctvMacroRegionForViewport(-17.7134, 178.0650)).toBe('australia'); // Fiji
    expect(cctvMacroRegionForViewport(-17.5516, -149.5585)).toBe('australia'); // Tahiti
    expect(cctvMacroRegionForViewport(21.3069, -157.8583)).toBe('australia'); // Honolulu
  });

  it('preserves dedicated New Zealand, Japan and western Europe routing', () => {
    expect(cctvMacroRegionForViewport(-41.2866, 174.7756)).toBeNull(); // Wellington / NZTA
    expect(cctvMacroRegionForViewport(35.6762, 139.6503)).toBeNull(); // Tokyo
    expect(cctvMacroRegionForViewport(52.2297, 21.0122)).toBeNull(); // Warsaw
  });

  it('rejects invalid coordinates and points outside the macro belts', () => {
    expect(cctvMacroRegionForViewport(Number.NaN, 90)).toBeNull();
    expect(cctvMacroRegionForViewport(85, 90)).toBeNull();
    expect(cctvMacroRegionForViewport(50, -20)).toBeNull();
  });
});

describe('routeCctvViewportUrl', () => {
  it('adds westasia to matching northern-Eurasia coordinate requests', () => {
    const routed = new URL(routeCctvViewportUrl(
      'http://localhost/api/cctv?lat=55.7558&lng=37.6173&radius=10',
    ));

    expect(routed.searchParams.get('region')).toBe('westasia');
    expect(routed.searchParams.get('radius')).toBe('10');
  });

  it('adds australia to Pacific coordinate requests', () => {
    const routed = new URL(routeCctvViewportUrl(
      'http://localhost/api/cctv?lat=-17.7134&lng=178.065&radius=10',
    ));
    expect(routed.searchParams.get('region')).toBe('australia');
  });

  it('preserves an explicit region exactly', () => {
    const url = 'http://localhost/api/cctv?region=japan&lat=55.7558&lng=37.6173';
    expect(routeCctvViewportUrl(url)).toBe(url);
  });

  it('does not rewrite dedicated or non-macro coordinate requests', () => {
    const tokyo = 'http://localhost/api/cctv?lat=35.6762&lng=139.6503';
    const wellington = 'http://localhost/api/cctv?lat=-41.2866&lng=174.7756';
    const outside = 'http://localhost/api/cctv?lat=50&lng=-20';
    expect(routeCctvViewportUrl(tokyo)).toBe(tokyo);
    expect(routeCctvViewportUrl(wellington)).toBe(wellington);
    expect(routeCctvViewportUrl(outside)).toBe(outside);
  });
});
