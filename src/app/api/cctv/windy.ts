import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import { noteCctvProviderScope } from '@/lib/cctv-provider-health';
import type { CctvCamera } from './types';

const API = 'https://api.windy.com/webcams/api/v3/webcams';
const SOURCE = 'Webcams provided by Windy.com';
const LIMIT = 50;

type WindyPlayerValue = string | { embed?: string | null } | null | undefined;

export interface WindyWebcam {
  webcamId?: number;
  status?: 'active' | 'inactive' | string;
  title?: string | null;
  location?: {
    city?: string | null;
    country?: string | null;
    country_code?: string | null;
    latitude?: number;
    longitude?: number;
  } | null;
  player?: {
    live?: WindyPlayerValue;
  } | null;
  urls?: {
    detail?: string | null;
  } | null;
}

interface WindyResponse {
  total?: number;
  webcams?: WindyWebcam[];
}

interface Cell {
  north: number;
  east: number;
  south: number;
  west: number;
}

/* Macro cells deliberately overlap only at their edges. Multiple moderate
 * boxes provide better geographic breadth than asking the API for the first
 * 50 popular cameras on an entire continent. */
const EUROPE: Cell[] = [
  { north: 72, east: 15, south: 50, west: -15 },
  { north: 72, east: 45, south: 50, west: 15 },
  { north: 50, east: 15, south: 35, west: -15 },
  { north: 50, east: 45, south: 35, west: 15 },
];

const EURASIA: Cell[] = [
  { north: 72, east: 80, south: 50, west: 30 },
  { north: 72, east: 130, south: 50, west: 80 },
  { north: 72, east: 180, south: 50, west: 130 },
  { north: 50, east: 90, south: 35, west: 30 },
  { north: 50, east: 150, south: 35, west: 90 },
];

const EAST_ASIA: Cell[] = [
  { north: 50, east: 120, south: 25, west: 90 },
  { north: 50, east: 150, south: 25, west: 120 },
  { north: 25, east: 120, south: 5, west: 90 },
  { north: 25, east: 150, south: 5, west: 120 },
];

export const WINDY_WORLD_CELLS = {
  latam: [
    { north: 33, east: -75, south: 0, west: -119 },
    { north: 33, east: -34, south: 0, west: -75 },
    { north: 0, east: -75, south: -56, west: -119 },
    { north: 0, east: -34, south: -56, west: -75 },
  ],
  africa: [
    { north: 36, east: 15, south: 0, west: -26 },
    { north: 36, east: 57, south: 0, west: 15 },
    { north: 0, east: 15, south: -35, west: -26 },
    { north: 0, east: 57, south: -35, west: 15 },
  ],
  oceania: [
    { north: 10, east: 150, south: -50, west: 110 },
    { north: 10, east: 180, south: -50, west: 150 },
    { north: 30, east: -150, south: -30, west: -180 },
    { north: 30, east: -120, south: -30, west: -150 },
  ],
} satisfies Record<string, Cell[]>;

export type WindyWorldScope = keyof typeof WINDY_WORLD_CELLS;

export function windyWorldMacroContains(scope: WindyWorldScope, lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return WINDY_WORLD_CELLS[scope].some(cell =>
    lat > cell.south && lat < cell.north && lng > cell.west && lng < cell.east,
  );
}

function safeHttps(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function liveEmbed(value: WindyPlayerValue): string | undefined {
  if (typeof value === 'string') return safeHttps(value);
  if (value && typeof value === 'object') return safeHttps(value.embed);
  return undefined;
}

/**
 * Map only genuine live Windy players.
 *
 * Windy's V3 image URLs are short-lived bearer-token URLs (about ten minutes
 * on the free tier). OSIRIS intentionally does not persist them inside its
 * 30-minute camera-index cache. The Windy player embed is the supported stable
 * free-tier integration surface and keeps Windy attribution inside the player.
 */
export function mapWindyWebcam(webcam: WindyWebcam): CctvCamera | null {
  if (!webcam.webcamId || webcam.status === 'inactive') return null;

  const lat = webcam.location?.latitude;
  const lng = webcam.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const embed = liveEmbed(webcam.player?.live);
  if (!embed) return null;

  const detail = safeHttps(webcam.urls?.detail);
  const city = webcam.location?.city?.trim() || '';
  const country = webcam.location?.country?.trim()
    || webcam.location?.country_code?.trim()
    || '';

  return {
    id: `windy-${webcam.webcamId}`,
    lat,
    lng,
    name: webcam.title?.trim() || city || 'Windy Webcam',
    city,
    country,
    stream_url: embed,
    stream_type: 'iframe',
    ...(detail ? { external_url: detail } : {}),
    source: SOURCE,
  };
}

function bbox(cell: Cell) {
  return `${cell.north},${cell.east},${cell.south},${cell.west}`;
}

async function fetchCell(cell: Cell, apiKey: string): Promise<CctvCamera[]> {
  const params = new URLSearchParams({
    bbox: bbox(cell),
    include: 'location,player,urls',
    lang: 'en',
    limit: String(LIMIT),
    sortKey: 'popularity',
    sortDirection: 'desc',
  });

  const response = await stealthFetch(`${API}?${params}`, {
    headers: {
      Accept: 'application/json',
      'X-WINDY-API-KEY': apiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`Windy Webcams HTTP ${response.status}`);
  const payload = await response.json() as WindyResponse;
  const rows = Array.isArray(payload.webcams) ? payload.webcams : [];
  return rows.map(mapWindyWebcam).filter((camera): camera is CctvCamera => camera !== null);
}

async function fetchMacro(scope: string, label: string, cells: Cell[]): Promise<CctvCamera[]> {
  const apiKey = process.env.WINDY_WEBCAMS_API_KEY?.trim();
  if (!apiKey) {
    noteCctvProviderScope('windy', scope, {
      state: 'disabled',
      enabled: false,
      cameras: 0,
    });
    return [];
  }

  const started = Date.now();
  const results = await Promise.allSettled(cells.map(cell => fetchCell(cell, apiKey)));
  const cameras = new Map<string, CctvCamera>();
  const failures: string[] = [];

  for (const result of results) {
    if (result.status === 'rejected') {
      failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    for (const camera of result.value) cameras.set(camera.id, camera);
  }

  const state = failures.length === 0
    ? 'healthy'
    : failures.length === cells.length
      ? 'error'
      : 'partial';
  noteCctvProviderScope('windy', scope, {
    state,
    enabled: true,
    cameras: cameras.size,
    durationMs: Date.now() - started,
    error: failures.length ? `${failures.length}/${cells.length} cells failed: ${failures[0]}` : undefined,
  });

  if (failures.length) console.warn(`[OSIRIS] Windy ${label}: ${failures.length}/${cells.length} cells failed`);
  console.log(`[OSIRIS] Windy ${label}: ${cameras.size} live webcams`);
  return [...cameras.values()];
}

/* These macro fetchers are shared by multiple route regions. Caching at this
 * level prevents `region=all` from querying the same Windy cells twice when,
 * for example, Eurasia is requested both through westasia and europe-live. */
export const fetchWindyEuropeCameras = cachedSource(
  'windy:europe',
  () => fetchMacro('europe', 'Europe', EUROPE),
);

export const fetchWindyEurasiaCameras = cachedSource(
  'windy:eurasia',
  () => fetchMacro('eurasia', 'Russia & Eurasia', EURASIA),
);

export const fetchWindyEastAsiaCameras = cachedSource(
  'windy:eastasia',
  () => fetchMacro('eastasia', 'East Asia', EAST_ASIA),
);

export const fetchWindyLatamCameras = cachedSource(
  'windy:latam',
  () => fetchMacro('latam', 'Latin America', WINDY_WORLD_CELLS.latam),
);

export const fetchWindyAfricaCameras = cachedSource(
  'windy:africa',
  () => fetchMacro('africa', 'Africa', WINDY_WORLD_CELLS.africa),
);

export const fetchWindyOceaniaCameras = cachedSource(
  'windy:oceania',
  () => fetchMacro('oceania', 'Oceania & Pacific', WINDY_WORLD_CELLS.oceania),
);
