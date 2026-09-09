import type { CctvCamera } from './types';
import { fetchEuropeOpenCctvCameras } from './opencctv';
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
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    fetchEuropeOpenCctvCameras().finally(() => clearTimeout(timer)),
    new Promise<CctvCamera[]>(resolve => {
      timer = setTimeout(() => resolve([]), 7000);
    }),
  ]);
}

export async function fetchEuropeLiveCameras(): Promise<CctvCamera[]> {
  const openCctv = await optionalEuropeOpenCctv();
  const seen = new Map<string, CctvCamera>();
  for (const camera of EUROPE_SKYLINE_CAMERAS) seen.set(camera.id, camera);
  for (const camera of openCctv) seen.set(camera.id, camera);
  return [...seen.values()];
}
