import { describe, expect, it } from 'vitest';
import { cctvMacroRegionForViewport } from './region-routing';

describe('cctvMacroRegionForViewport', () => {
  it('routes European Russia, Siberia and the Russian Far East to westasia', () => {
    expect(cctvMacroRegionForViewport(55.7558, 37.6173)).toBe('westasia'); // Moscow
    expect(cctvMacroRegionForViewport(55.0084, 82.9357)).toBe('westasia'); // Novosibirsk
    expect(cctvMacroRegionForViewport(62.0355, 129.6755)).toBe('westasia'); // Yakutsk
    expect(cctvMacroRegionForViewport(53.037, 158.6559)).toBe('westasia'); // Kamchatka
  });

  it('leaves dedicated Japan and western Europe routing untouched', () => {
    expect(cctvMacroRegionForViewport(35.6762, 139.6503)).toBeNull(); // Tokyo
    expect(cctvMacroRegionForViewport(52.2297, 21.0122)).toBeNull(); // Warsaw
  });

  it('rejects invalid coordinates and points outside the macro belt', () => {
    expect(cctvMacroRegionForViewport(Number.NaN, 90)).toBeNull();
    expect(cctvMacroRegionForViewport(85, 90)).toBeNull();
    expect(cctvMacroRegionForViewport(50, -20)).toBeNull();
  });
});
