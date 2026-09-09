import { GET as getCctvImpl } from './route-impl';
import { routeCctvViewportUrl } from './region-routing';

/**
 * Preserve explicit region requests. For coordinate-driven requests, repair
 * the northern-Eurasia gap before delegating to the original CCTV route.
 */
export async function getCctvWithMacroRouting(request: Request) {
  const routedUrl = routeCctvViewportUrl(request.url);
  if (routedUrl === request.url) return getCctvImpl(request);
  return getCctvImpl(new Request(routedUrl, request));
}
