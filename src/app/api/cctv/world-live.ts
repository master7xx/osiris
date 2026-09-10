import type { CctvCamera } from './types';
import { fetchEuropeOpenCctvCameras } from './opencctv';
import { fetchAfricaOpenCctvCameras, fetchLatamOpenCctvCameras } from './opencctv-world';
import {
  fetchWindyAfricaCameras,
  fetchWindyEuropeCameras,
  fetchWindyEurasiaCameras,
  fetchWindyLatamCameras,
} from './windy';
import {
  LATAM_SKYLINE_CAMERAS,
  AFRICA_SKYLINE_CAMERAS,
  EUROPE_SKYLINE_CAMERAS,
} from './world-skyline.generated';

/**
 * OSIRIS — public live webcams outside Asia.
 *
 * Latin America, Africa and Europe combine a bundled curated layer with a
 * spatially sampled OpenCCTV macro layer. National traffic-authority adapters
 * remain separate and authoritative where available. When
 * WINDY_WEBCAMS_API_KEY is configured, Windy's supported live-player embeds
 * add a second global discovery layer without replacing any keyless source.
 */

/**
 * OpenCCTV is enrichment, never a prerequisite for a macro region.
 *
 * Its worldwide marker index is large and can take longer on a degraded
 * connection. Return the bundled catalogue after seven seconds rather than
 * letting optional enrichment consume the route's whole 12-second budget.
 * The abandoned fetch continues inside sourceCache, warming the next request.
 */
async function optionalOpenCctv(fetcher: () => Promise<CctvCamera[]>): Promise<CctvCamera[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    fetcher().finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<CctvCamera[]>(resolve => {
      timer = setTimeout(() => resolve([]), 7000);
    }),
  ]);
}

function mergeById(...groups: CctvCamera[][]): CctvCamera[] {
  const seen = new Map<string, CctvCamera>();
  for (const group of groups) {
    for (const camera of group) seen.set(camera.id, camera);
  }
  return [...seen.values()];
}

export async function fetchLatamLiveCameras(): Promise<CctvCamera[]> {
  const [openCctv, windy] = await Promise.all([
    optionalOpenCctv(fetchLatamOpenCctvCameras),
    fetchWindyLatamCameras(),
  ]);
  return mergeById(LATAM_SKYLINE_CAMERAS, openCctv, windy);
}

export async function fetchAfricaLiveCameras(): Promise<CctvCamera[]> {
  const [openCctv, windy] = await Promise.all([
    optionalOpenCctv(fetchAfricaOpenCctvCameras),
    fetchWindyAfricaCameras(),
  ]);
  return mergeById(AFRICA_SKYLINE_CAMERAS, openCctv, windy);
}

export async function fetchEuropeLiveCameras(): Promise<CctvCamera[]> {
  const [openCctv, windyEurope, windyEurasia] = await Promise.all([
    optionalOpenCctv(fetchEuropeOpenCctvCameras),
    fetchWindyEuropeCameras(),
    fetchWindyEurasiaCameras(),
  ]);

  /* Eurasia is included here so a global/region=all request gains Russia and
     Siberia coverage as well as the dedicated westasia viewport path. */
  return mergeById(EUROPE_SKYLINE_CAMERAS, openCctv, windyEurope, windyEurasia);
}
