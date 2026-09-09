import type { CctvCamera } from './types';
import { ASIA_SKYLINE_CAMERAS } from './asia-skyline.generated';
import { fetchWindyEastAsiaCameras } from './windy';

/**
 * OSIRIS — Asia live public webcams.
 *
 * Complements the traffic-authority feeds already wired up for the region
 * (HK Transport Dept, Taiwan THB, Japan MLIT, LTA Singapore) with open public
 * webcams in countries that publish no machine-readable CCTV feed of their own.
 * WINDY_WEBCAMS_API_KEY optionally adds Windy's supported live-player embeds;
 * the keyless curated catalogue remains the baseline and never depends on it.
 */
export async function fetchAsiaLiveCameras(): Promise<CctvCamera[]> {
  const windy = await fetchWindyEastAsiaCameras();
  const seen = new Map<string, CctvCamera>();
  for (const camera of ASIA_SKYLINE_CAMERAS) seen.set(camera.id, camera);
  for (const camera of windy) seen.set(camera.id, camera);
  return [...seen.values()];
}
