export type OpenCctvMacroRegion = 'latam' | 'africa';

/**
 * Classify coordinates into the new broad OpenCCTV coverage areas.
 * Existing Europe/Asia loaders remain authoritative for their regions.
 */
export function cameraMacroRegion(lat: number, lng: number): OpenCctvMacroRegion[] {
  const regions: OpenCctvMacroRegion[] = [];
  if (lat > -56 && lat < 33 && lng > -119 && lng < -34) regions.push('latam');
  if (lat > -35 && lat < 36 && lng > -26 && lng < 57) regions.push('africa');
  return regions;
}
