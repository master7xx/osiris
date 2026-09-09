import { GET as getCctvImpl } from './route-impl';
import { cctvMacroRegionForViewport } from './region-routing';

/**
 * Preserve explicit region requests. For coordinate-driven requests, repair
 * the northern-Eurasia gap before delegating to the original CCTV route.
 */
export async function getCctvWithMacroRouting(request: Request) {
  const url = new URL(request.url);
  if (!url.searchParams.has('region')) {
    const lat = Number.parseFloat(url.searchParams.get('lat') || 'NaN');
    const lng = Number.parseFloat(url.searchParams.get('lng') || 'NaN');
    const macro = cctvMacroRegionForViewport(lat, lng);
    if (macro) url.searchParams.set('region', macro);
  }

  if (url.toString() === request.url) return getCctvImpl(request);
  return getCctvImpl(new Request(url, request));
}
