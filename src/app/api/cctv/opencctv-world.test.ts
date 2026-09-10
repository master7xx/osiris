import { describe, expect, it } from 'vitest';
import { insideWorldMacro, WORLD_MACROS } from './opencctv-world';

describe('OpenCCTV world macro bounds', () => {
  it('covers representative Latin America locations', () => {
    expect(insideWorldMacro('latam', -23.55, -46.63)).toBe(true); // Sao Paulo
    expect(insideWorldMacro('latam', 19.43, -99.13)).toBe(true); // Mexico City
    expect(insideWorldMacro('latam', -34.60, -58.38)).toBe(true); // Buenos Aires
  });

  it('covers representative African locations', () => {
    expect(insideWorldMacro('africa', -33.92, 18.42)).toBe(true); // Cape Town
    expect(insideWorldMacro('africa', -1.29, 36.82)).toBe(true); // Nairobi
    expect(insideWorldMacro('africa', 30.04, 31.24)).toBe(true); // Cairo
  });

  it('covers Oceania on both sides of the antimeridian', () => {
    expect(insideWorldMacro('oceania', -33.87, 151.21)).toBe(true); // Sydney
    expect(insideWorldMacro('oceania', -17.71, 178.07)).toBe(true); // Fiji
    expect(insideWorldMacro('oceania', -17.55, -149.56)).toBe(true); // Tahiti
    expect(insideWorldMacro('oceania', 21.31, -157.86)).toBe(true); // Honolulu
  });

  it('does not leak Europe or East Asia into the new world regions', () => {
    expect(insideWorldMacro('latam', 52.52, 13.405)).toBe(false);
    expect(insideWorldMacro('africa', 35.68, 139.76)).toBe(false);
    expect(insideWorldMacro('oceania', 35.68, 139.76)).toBe(false);
  });

  it('keeps continental caps bounded for world-scale overview', () => {
    expect(WORLD_MACROS.latam.cap).toBeLessThanOrEqual(500);
    expect(WORLD_MACROS.africa.cap).toBeLessThanOrEqual(500);
    expect(WORLD_MACROS.oceania.cap).toBeLessThanOrEqual(500);
    expect(WORLD_MACROS.latam.cellDegrees).toBeGreaterThanOrEqual(4);
    expect(WORLD_MACROS.africa.cellDegrees).toBeGreaterThanOrEqual(4);
    expect(WORLD_MACROS.oceania.cellDegrees).toBeGreaterThanOrEqual(5);
  });
});
