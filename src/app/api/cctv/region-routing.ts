export type CctvMacroRegion = 'westasia' | 'australia';

/**
 * Macro overrides repair gaps in the legacy region selector without changing
 * its large registry. Keep them deliberately narrow so dedicated national
 * sources continue to win where they exist.
 */
export function cctvMacroRegionForViewport(lat: number, lng: number): CctvMacroRegion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // European Russia through Siberia and the Russian Far East.
  if (lat > 46 && lat < 82 && lng > 30 && lng < 180) return 'westasia';

  // Preserve the dedicated NZTA New Zealand route.
  const inNewZealand = lat > -47.5 && lat < -34 && lng > 166 && lng < 179;
  if (inNewZealand) return null;

  // Australia plus Melanesia/Micronesia and the Pacific across the dateline.
  const inAustralia = lat > -45 && lat < -10 && lng > 110 && lng < 155;
  const inWestPacific = lat > -30 && lat < 10 && lng > 130 && lng < 180;
  const inEastPacific = lat > -30 && lat < 30 && lng > -180 && lng < -120;
  if (inAustralia || inWestPacific || inEastPacific) return 'australia';

  return null;
}

/**
 * Add a macro-region override only to coordinate-driven requests. Explicit
 * region queries are operator intent and must never be replaced.
 */
export function routeCctvViewportUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.searchParams.has('region')) return rawUrl;

  const lat = Number.parseFloat(url.searchParams.get('lat') || 'NaN');
  const lng = Number.parseFloat(url.searchParams.get('lng') || 'NaN');
  const macro = cctvMacroRegionForViewport(lat, lng);
  if (!macro) return rawUrl;

  url.searchParams.set('region', macro);
  return url.toString();
}
