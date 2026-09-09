export type CctvMacroRegion = 'westasia';

/**
 * OpenCCTV's `westasia` macro source is a union of the original West/Central
 * Asia box and the northern Eurasian belt. The old route selector still used
 * the original, smaller bounds, so Moscow, Siberia and the Russian Far East
 * could fall through to unrelated UK/US fallback sources while panning.
 *
 * Keep the override intentionally narrow: Japan and the lower East-Asia box
 * retain their dedicated sources, while the belt from European Russia through
 * Siberia is routed to the macro source that actually contains those cameras.
 */
export function cctvMacroRegionForViewport(lat: number, lng: number): CctvMacroRegion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat > 46 && lat < 82 && lng > 30 && lng < 180) return 'westasia';
  return null;
}
