import type { CctvCamera } from './types';
import { fetchUsgsVolcanoCameras } from './usgs-volcano';

const STRATEGIC_BUDGET_MS = 6_000;

/**
 * USGS Ashcam currently concentrates on the Cascades and Alaska/Aleutians.
 * Keep the source out of unrelated viewport requests while still including it
 * in global snapshots and the existing western-US region families.
 */
export function shouldFetchUsgsVolcano(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  const region = url.searchParams.get('region');
  if (region === 'all' || region === 'us-west' || region === 'oregon') return true;
  if (region) return false;

  const latRaw = url.searchParams.get('lat');
  const lngRaw = url.searchParams.get('lng');
  if (latRaw === null && lngRaw === null) return true;

  const lat = Number.parseFloat(latRaw || 'NaN');
  const lng = Number.parseFloat(lngRaw || 'NaN');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  const cascades = lat >= 40 && lat <= 50 && lng >= -126 && lng <= -115;
  const alaskaAleutians = lat >= 50 && lat <= 72 && lng >= -180 && lng <= -130;
  return cascades || alaskaAleutians;
}

async function withSoftBudget(fetcher: () => Promise<CctvCamera[]>): Promise<CctvCamera[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    fetcher().finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<CctvCamera[]>(resolve => {
      timer = setTimeout(() => resolve([]), STRATEGIC_BUDGET_MS);
    }),
  ]);
}

/**
 * High-information-value cameras are optional enrichment, never a reason to
 * delay or fail the ordinary CCTV response. The sourceCache-backed request
 * keeps running after the soft budget and warms the next request.
 */
export async function fetchStrategicCctvForRequest(rawUrl: string): Promise<CctvCamera[]> {
  if (!shouldFetchUsgsVolcano(rawUrl)) return [];
  try {
    return await withSoftBudget(fetchUsgsVolcanoCameras);
  } catch {
    return [];
  }
}
