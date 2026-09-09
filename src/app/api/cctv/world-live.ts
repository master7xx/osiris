import type { CctvCamera } from './types';
import { fetchEuropeOpenCctvCameras } from './opencctv';
import { fetchWindyEuropeCameras, fetchWindyEurasiaCameras } from './windy';
import {
  LATAM_SKYLINE_CAMERAS,
  AFRICA_SKYLINE_CAMERAS,
  EUROPE_SKYLINE_CAMERAS,
} from './world-skyline.generated';

/**
 * OSIRIS — public live webcams outside Asia.
 *
 * Latin America and Africa use the curated generated catalogue. Europe combines
 * that curated layer with a spatially sampled OpenCCTV macro layer; national
 * traffic-authority adapters remain separate and take care of their own regions.
 * When WINDY_WEBCAMS_API_KEY is configured, Windy's supported live-player
 * embeds add another optional global-discovery layer without replacing any
 * keyless source.
 */

export async function fetchLatamLiveCameras(): Promise<CctvCamera[]> {
  return LATAM_SKYLINE_CAMERAS;
}

export async function fetchAfricaLiveCameras(): Promise<CctvCamera[]> {
  return AFRICA_SKYLINE_CAMERAS;
}

/**
 * OpenCCTV is enrichment, not a prerequisite for Europe.
 *
 * Its shared worldwide marker index is large and can take longer on a degraded
 * connection. Return the already-bundled European catalogue after seven
 * seconds rather than letting optional enrichment consume the route's whole
 * 12-second region budget. The abandoned fetch continues inside sourceCache,
 * so a later refresh can pick up the warmed global sample.
 */
async function optionalEuropeOpenCctv(): Promise<CctvCamera[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    fetchEuropeOpenCctvCameras().finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<CctvCamera[]>(resolve => {
      timer = setTimeout(() => resolve([]), 7000);
    }),
  ]);
}

export async function fetchEuropeLiveCameras(): Promise<CctvCamera[]> {
  const [openCctv, windyEurope, windyEurasia] = await Promise.all([
    optionalEuropeOpenCctv(),
    fetchWindyEuropeCameras(),
    fetchWindyEurasiaCameras(),
  ]);

  const seen = new Map<string, CctvCamera>();
  for (const camera of EUROPE_SKYLINE_CAMERAS) seen.set(camera.id, camera);
  for (const camera of openCctv) seen.set(camera.id, camera);
  for (const camera of windyEurope) seen.set(camera.id, camera);
  /* Eurasia is included here so a global/region=all request gains Russia and
     Siberia coverage even before the viewport router grows its own northern
     Eurasia region. IDs are globally stable and deduplicated by webcam id. */
  for (const camera of windyEurasia) seen.set(camera.id, camera);
  return [...seen.values()];
}
