import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { fetchOceaniaOpenCctvCameras } from './opencctv-world';
import { fetchWindyOceaniaCameras } from './windy';

async function fetchOfficialAustraliaCameras(): Promise<CctvCamera[]> {
  try {
    const res = await stealthFetch('https://www.livetraffic.com/datajson/all-feeds-web.json', {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || [])
      .filter((event: { eventType: string }) => event.eventType === 'liveCams')
      .map((cam: {
        path: string;
        geometry: { coordinates: number[] };
        properties: { title: string; region: string; href: string };
      }): CctvCamera => ({
        id: cam.path,
        lat: cam.geometry.coordinates[1],
        lng: cam.geometry.coordinates[0],
        name: cam.properties.title || 'Australia Camera',
        city: cam.properties.region || 'Australia',
        country: 'Australia',
        feed_url: cam.properties.href || '',
        source: 'Live Traffic',
      }))
      .filter((camera: CctvCamera) => Boolean(camera.lat && camera.lng));
  } catch {
    return [];
  }
}

/**
 * The internal `australia` region also acts as the broad Oceania/Pacific macro
 * fallback. Official Live Traffic cameras remain the preferred Australian
 * layer; OpenCCTV fills keyless regional gaps and Windy adds optional source
 * diversity when WINDY_WEBCAMS_API_KEY is configured.
 */
export async function fetchAustraliaCameras(): Promise<CctvCamera[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const optionalOpenCctv = Promise.race([
    fetchOceaniaOpenCctvCameras().finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<CctvCamera[]>(resolve => {
      timer = setTimeout(() => resolve([]), 7000);
    }),
  ]);

  const [official, openCctv, windy] = await Promise.all([
    fetchOfficialAustraliaCameras(),
    optionalOpenCctv,
    fetchWindyOceaniaCameras(),
  ]);

  const seen = new Map<string, CctvCamera>();
  for (const camera of official) seen.set(camera.id, camera);
  for (const camera of openCctv) seen.set(camera.id, camera);
  for (const camera of windy) seen.set(camera.id, camera);
  return [...seen.values()];
}
