import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import { noteCctvProviderScope } from '@/lib/cctv-provider-health';
import type { CctvCamera, CctvStreamType } from './types';

/**
 * OSIRIS — macro-region cameras via the OpenCCTV directory.
 *
 * Source: https://opencctv.org — an aggregator carrying ~145,000 public
 * cameras worldwide. OSIRIS uses it as a broad coverage layer underneath the
 * higher-quality national and municipal adapters: Europe, East/Southeast Asia,
 * and the West/Central/North Asian belt including Russia and Siberia.
 *
 * Two endpoints, both the ones the site's own map calls:
 *
 *   GET  /api/cameras/markers   the whole index as parallel arrays — id, lat,
 *                               lng — and nothing else. 7.3 MB, and it ignores
 *                               every filter parameter tried, so the shape of
 *                               this module is set by having to take all of it
 *                               and narrow locally.
 *   POST /api/cameras/batch     {ids:[…]} → full records. It answers with at
 *                               most 50 rows however many ids are sent, which
 *                               is what BATCH_SIZE encodes and why large
 *                               regions are spatially sampled rather than
 *                               materialised wholesale.
 */

const MARKERS = 'https://opencctv.org/api/cameras/markers';
const BATCH = 'https://opencctv.org/api/cameras/batch';

/** The server truncates a batch response to 50 rows regardless of ids sent. */
const BATCH_SIZE = 50;

interface Bounds { minLat: number; maxLat: number; minLng: number; maxLng: number }
interface RegionSpec {
  /** A region can be a union of boxes — useful for West/Central Asia + Russia. */
  areas: Bounds[];
  cap: number;
  /** Coarse cell size used by spatial sampling. */
  cellDegrees: number;
}

const REGIONS: Record<string, RegionSpec> = {
  /* China, Japan, the Koreas and Taiwan — ~24,000 candidates. */
  eastasia: {
    areas: [{ minLat: 18, maxLat: 46, minLng: 73.5, maxLng: 146 }],
    cap: 1200,
    cellDegrees: 3,
  },
  /* Indochina, Indonesia, the Philippines — ~7,700 candidates. */
  seasia: {
    areas: [{ minLat: -11, maxLat: 24, minLng: 92, maxLng: 130 }],
    cap: 800,
    cellDegrees: 2.5,
  },
  /* Existing West/Central Asia plus the northern Eurasian belt. Keeping both
     inside the existing `westasia` loader avoids another giant marker-index
     download or another viewport registry dependency; the shared index is
     still fetched only once. */
  westasia: {
    areas: [
      { minLat: 5, maxLat: 56, minLng: 25, maxLng: 92 },
      { minLat: 46, maxLat: 82, minLng: 30, maxLng: 180 },
    ],
    cap: 1200,
    cellDegrees: 4,
  },
  /* Broad European discovery layer. National adapters remain authoritative;
     this fills gaps between them and greatly improves geographic density. */
  europe: {
    areas: [{ minLat: 35, maxLat: 72, minLng: -12, maxLng: 32 }],
    cap: 1200,
    cellDegrees: 3,
  },
};

/** The index, as three parallel arrays. */
interface MarkerIndex {
  ids?: string[];
  lats?: number[];
  lngs?: number[];
}

export interface MarkerCandidate {
  id: string;
  lat: number;
  lng: number;
}

/** One row from /api/cameras/batch (only the fields we consume). */
export interface OpenCctvRecord {
  id?: string;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number;
  lng?: number;
  feed_url?: string | null;
  feed_type?: string | null;
  source?: string | null;
  active?: number;
  /** Set when appending a query string to feed_url returns an error instead. */
  cache_buster_breaks_url?: boolean;
}

/** OpenCCTV's `feed_type` in OSIRIS's vocabulary; null means unusable. */
export function streamKind(feedType?: string | null): CctvStreamType | 'jpg' | null {
  switch ((feedType || '').toLowerCase()) {
    case 'm3u8':
    case 'hls': return 'hls';
    case 'mjpeg': return 'mjpeg';
    case 'image': return 'jpg';
    case 'iframe': return 'iframe';
    default: return null;
  }
}

/** Map one record to a camera, or null if it should be skipped. */
export function mapRecord(rec: OpenCctvRecord): CctvCamera | null {
  if (!rec?.id || rec.active === 0) return null;

  const url = rec.feed_url?.trim();
  if (!url) return null;

  const kind = streamKind(rec.feed_type);
  if (!kind) return null;

  const { lat, lng } = rec;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  /* A snapshot tile re-requests with `?_t=` on every refresh. Where the source
     has recorded that a query string breaks the URL, that tile would turn into
     a broken box the moment it refreshed, so it never gets one. */
  if (kind === 'jpg' && rec.cache_buster_breaks_url) return null;

  const name = rec.name?.trim() || rec.city?.trim() || 'Camera';

  return {
    id: `occ-${rec.id}`,
    lat,
    lng,
    name,
    city: rec.city?.trim() || '',
    country: rec.country?.trim() || '',
    /* A still is a feed_url; everything else is a stream the player picks up. */
    ...(kind === 'jpg' ? { feed_url: url } : { stream_url: url, stream_type: kind }),
    source: rec.source?.trim() ? `OpenCCTV / ${rec.source.trim()}` : 'OpenCCTV',
  };
}

/**
 * Thin a list to a cap by walking it at a fixed stride.
 * Kept as a generic helper and as a useful fallback for tests/small lists.
 */
export function sample<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const stride = items.length / cap;
  const out: T[] = [];
  for (let i = 0; out.length < cap && Math.floor(i) < items.length; i += stride) {
    out.push(items[Math.floor(i)]);
  }
  return out;
}

/**
 * Prefer geographic breadth over index order.
 *
 * OpenCCTV's marker list is grouped strongly by operator/place. A simple
 * stride helps, but a dense operator can still dominate a continental sample.
 * Bucketing markers into coarse geographic cells and taking one item from each
 * cell before taking a second gives sparse countries and remote regions a fair
 * chance to appear without increasing the request cap.
 */
export function sampleSpatial(
  items: MarkerCandidate[],
  cap: number,
  cellDegrees = 3,
): MarkerCandidate[] {
  if (items.length <= cap) return items;
  if (cap <= 0) return [];

  const buckets = new Map<string, MarkerCandidate[]>();
  for (const item of items) {
    const latCell = Math.floor(item.lat / cellDegrees);
    const lngCell = Math.floor(item.lng / cellDegrees);
    const key = `${latCell}:${lngCell}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const queues = [...buckets.values()];
  const out: MarkerCandidate[] = [];
  for (let depth = 0; out.length < cap; depth++) {
    let added = false;
    for (const bucket of queues) {
      if (depth >= bucket.length) continue;
      out.push(bucket[depth]);
      added = true;
      if (out.length === cap) break;
    }
    if (!added) break;
  }
  return out;
}

function inside(bounds: Bounds, lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat > bounds.minLat && lat < bounds.maxLat &&
    lng > bounds.minLng && lng < bounds.maxLng;
}

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

/** The marker index, fetched once and shared by every macro-region. */
const markerIndex = cachedSource('opencctv-index', async (): Promise<MarkerIndex[]> => {
  const started = Date.now();
  try {
    const res = await stealthFetch(MARKERS, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', Referer: 'https://opencctv.org/' },
    });
    if (!res.ok) throw new Error(`OpenCCTV markers HTTP ${res.status}`);

    const index = (await res.json()) as MarkerIndex;
    if (!Array.isArray(index.ids) || !Array.isArray(index.lats) || !Array.isArray(index.lngs)) {
      throw new Error('OpenCCTV markers returned no index');
    }

    noteCctvProviderScope('opencctv', 'index', {
      state: 'healthy',
      cameras: 0,
      durationMs: Date.now() - started,
    });

    /* Wrapped in an array because the cache stores lists; it is one 7.3 MB
       download shared by all macro-regions rather than one download each. */
    return [index];
  } catch (error) {
    noteCctvProviderScope('opencctv', 'index', {
      state: 'error',
      cameras: 0,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

function loader(scope: string, region: string, spec: RegionSpec) {
  return async (): Promise<CctvCamera[]> => {
    const started = Date.now();
    try {
      const [index] = await markerIndex();
      if (!index) {
        noteCctvProviderScope('opencctv', scope, {
          state: 'error',
          cameras: 0,
          durationMs: Date.now() - started,
          error: 'marker index unavailable',
        });
        return [];
      }

      const ids = index.ids ?? [];
      const lats = index.lats ?? [];
      const lngs = index.lngs ?? [];

      const candidates = new Map<string, MarkerCandidate>();
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const lat = lats[i];
        const lng = lngs[i];
        if (!id || !spec.areas.some(bounds => inside(bounds, lat, lng))) continue;
        candidates.set(id, { id, lat, lng });
      }

      const inRegion = [...candidates.values()];
      const wanted = sampleSpatial(inRegion, spec.cap, spec.cellDegrees);
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

      const cams = [...seen.values()];
      const state = failed.length === 0 ? 'healthy' : cams.length > 0 ? 'partial' : 'error';
      noteCctvProviderScope('opencctv', scope, {
        state,
        cameras: cams.length,
        durationMs: Date.now() - started,
        error: failed.length ? `${failed.length}/${chunks.length} batch requests failed` : undefined,
      });

      console.log(`[OSIRIS] ${region} cameras — OpenCCTV: ${cams.length} of ${inRegion.length} in region`);
      return cams;
    } catch (error) {
      noteCctvProviderScope('opencctv', scope, {
        state: 'error',
        cameras: 0,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

export const fetchEastAsiaCameras = cachedSource('eastasia', loader('eastasia', 'East Asia', REGIONS.eastasia));
export const fetchSeAsiaCameras = cachedSource('seasia', loader('seasia', 'Southeast Asia', REGIONS.seasia));
export const fetchWestAsiaCameras = cachedSource('westasia', loader('westasia', 'West, Central & North Asia', REGIONS.westasia));
export const fetchEuropeOpenCctvCameras = cachedSource('europe-occ', loader('europe', 'Europe', REGIONS.europe));
