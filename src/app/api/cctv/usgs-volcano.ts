import { cachedSource } from '@/lib/sourceCache';
import { noteCctvProviderScope } from '@/lib/cctv-provider-health';
import { stealthFetch } from '@/lib/stealthFetch';
import type { CctvCamera } from './types';

const ASHCAM_API = 'https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams';
const SOURCE = 'USGS Volcano Hazards Program';

export interface UsgsAshcamRow {
  webcamCode?: string | null;
  webcamName?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  externalUrl?: string | null;
  vnum?: string | number | null;
  vName?: string | null;
  hasImages?: string | boolean | null;
  currentImageUrl?: string | null;
}

function safeHttps(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function looksRoadSpecific(name: string): boolean {
  return /\b(highway|traffic|road|dot)\b/i.test(name);
}

/**
 * Admit only volcano-linked observation cameras.
 *
 * Ashcam also ingests a small number of convenient roadside views. Those are
 * useful to the USGS applications but are outside OSIRIS's current CCTV
 * priority, so road-labelled rows are intentionally ignored even when they
 * happen to point toward a volcano.
 */
export function mapUsgsAshcam(row: UsgsAshcamRow): CctvCamera | null {
  const code = row.webcamCode?.trim();
  const volcano = row.vName?.trim() || String(row.vnum ?? '').trim();
  const name = row.webcamName?.trim() || '';
  if (!code || !volcano || !name || looksRoadSpecific(name)) return null;
  if (row.hasImages === false || String(row.hasImages ?? '').toUpperCase() === 'N') return null;

  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const feedUrl = safeHttps(row.currentImageUrl);
  if (!feedUrl) return null;
  const externalUrl = safeHttps(row.externalUrl);

  return {
    id: `usgs-volcano-${code}`,
    lat,
    lng,
    name,
    city: row.vName?.trim() || 'USGS Volcano Observatory',
    country: 'US',
    feed_url: feedUrl,
    ...(externalUrl && externalUrl !== feedUrl ? { external_url: externalUrl } : {}),
    source: SOURCE,
  };
}

async function loadUsgsVolcanoCameras(): Promise<CctvCamera[]> {
  const started = Date.now();
  try {
    const response = await stealthFetch(ASHCAM_API, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`USGS Ashcam HTTP ${response.status}`);

    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('USGS Ashcam returned a non-array payload');

    const seen = new Map<string, CctvCamera>();
    for (const row of payload as UsgsAshcamRow[]) {
      const camera = mapUsgsAshcam(row);
      if (camera) seen.set(camera.id, camera);
    }

    const cameras = [...seen.values()];
    noteCctvProviderScope('official', 'usgs-volcano', {
      state: 'healthy',
      cameras: cameras.length,
      durationMs: Date.now() - started,
    });
    console.log(`[OSIRIS] USGS volcano webcams: ${cameras.length}`);
    return cameras;
  } catch (error) {
    noteCctvProviderScope('official', 'usgs-volcano', {
      state: 'error',
      cameras: 0,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const fetchUsgsVolcanoCameras = cachedSource(
  'usgs-volcano',
  loadUsgsVolcanoCameras,
);
