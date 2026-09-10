import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import { noteCctvProviderScope } from '@/lib/cctv-provider-health';
import type { CctvCamera } from './types';
import { mapRecord, sampleSpatial, type MarkerCandidate, type OpenCctvRecord } from './opencctv';

const MARKERS = 'https://opencctv.org/api/cameras/markers';
const BATCH = 'https://opencctv.org/api/cameras/batch';
const BATCH_SIZE = 50;

interface MarkerIndex {
  ids?: string[];
  lats?: number[];
  lngs?: number[];
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface MacroSpec {
  bounds: Bounds;
  cap: number;
  cellDegrees: number;
}

export const WORLD_MACROS = {
  latam: {
    bounds: { minLat: -56, maxLat: 33, minLng: -119, maxLng: -34 },
    cap: 500,
    cellDegrees: 4,
  },
  africa: {
    bounds: { minLat: -35, maxLat: 36, minLng: -26, maxLng: 57 },
    cap: 500,
    cellDegrees: 4,
  },
} satisfies Record<string, MacroSpec>;

export function insideWorldMacro(scope: keyof typeof WORLD_MACROS, lat: number, lng: number): boolean {
  const b = WORLD_MACROS[scope].bounds;
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat > b.minLat && lat < b.maxLat && lng > b.minLng && lng < b.maxLng;
}

/* Use the exact same cache key as opencctv.ts. If an Asia/Europe loader already
   downloaded the 7 MB marker index, these world loaders reuse it; if this
   module gets there first, the existing loaders reuse this identical shape. */
const markerIndex = cachedSource('opencctv-index', async (): Promise<MarkerIndex[]> => {
  const started = Date.now();
  try {
    const res = await stealthFetch(MARKERS, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', Referer: 'https://opencctv.org/' },
    });
    if (!res.ok) throw new Error(`OpenCCTV markers HTTP ${res.status}`);
    const index = await res.json() as MarkerIndex;
    if (!Array.isArray(index.ids) || !Array.isArray(index.lats) || !Array.isArray(index.lngs)) {
      throw new Error('OpenCCTV markers returned no index');
    }
    noteCctvProviderScope('opencctv', 'index', {
      state: 'healthy', cameras: 0, durationMs: Date.now() - started,
    });
    return [index];
  } catch (error) {
    noteCctvProviderScope('opencctv', 'index', {
      state: 'error', cameras: 0, durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

async function fetchBatch(ids: string[]): Promise<OpenCctvRecord[]> {
  const res = await stealthFetch(BATCH, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Referer: 'https://opencctv.org/',
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`OpenCCTV batch HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

function worldLoader(scope: keyof typeof WORLD_MACROS, label: string) {
  const spec = WORLD_MACROS[scope];
  return async (): Promise<CctvCamera[]> => {
    const started = Date.now();
    try {
      const [index] = await markerIndex();
      if (!index) throw new Error('marker index unavailable');

      const candidates: MarkerCandidate[] = [];
      const ids = index.ids ?? [];
      const lats = index.lats ?? [];
      const lngs = index.lngs ?? [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const lat = lats[i];
        const lng = lngs[i];
        if (!id || !insideWorldMacro(scope, lat, lng)) continue;
        candidates.push({ id, lat, lng });
      }

      const wanted = sampleSpatial(candidates, spec.cap, spec.cellDegrees);
      const chunks: string[][] = [];
      for (let i = 0; i < wanted.length; i += BATCH_SIZE) {
        chunks.push(wanted.slice(i, i + BATCH_SIZE).map(item => item.id));
      }

      const results = await Promise.allSettled(chunks.map(fetchBatch));
      const failed = results.filter(result => result.status === 'rejected');
      const seen = new Map<string, CctvCamera>();
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        for (const rec of result.value) {
          const cam = mapRecord(rec);
          if (cam) seen.set(cam.id, cam);
        }
      }

      const cameras = [...seen.values()];
      noteCctvProviderScope('opencctv', scope, {
        state: failed.length === 0 ? 'healthy' : cameras.length > 0 ? 'partial' : 'error',
        cameras: cameras.length,
        durationMs: Date.now() - started,
        error: failed.length ? `${failed.length}/${chunks.length} batch requests failed` : undefined,
      });
      console.log(`[OSIRIS] ${label} cameras — OpenCCTV: ${cameras.length} of ${candidates.length} in region`);
      return cameras;
    } catch (error) {
      noteCctvProviderScope('opencctv', scope, {
        state: 'error', cameras: 0, durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

export const fetchLatamOpenCctvCameras = cachedSource(
  'latam-occ',
  worldLoader('latam', 'Latin America'),
);

export const fetchAfricaOpenCctvCameras = cachedSource(
  'africa-occ',
  worldLoader('africa', 'Africa'),
);
