import type { CctvCamera } from './types';

const ENDPOINT = 'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query';
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

const IOWA_BOUNDS = {
  minLat: 40.3,
  maxLat: 43.6,
  minLng: -96.7,
  maxLng: -90.0,
};

type IowaAttributes = {
  FID?: number | string;
  device_id?: number | string;
  Desc_?: string | null;
  Route?: string | null;
  ImageName?: string | null;
  ImageURL?: string | null;
  VideoURL?: string | null;
  ORG?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  REGION?: string | number | null;
  COMMON_ID?: string | null;
};

type IowaFeature = { attributes?: IowaAttributes | null };

type IowaPayload = {
  features?: IowaFeature[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
};

function publicHttpUrl(value?: string | null): string | null {
  const raw = value?.replace(/&amp;/gi, '&').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function hlsUrl(value?: string | null): string | null {
  const url = publicHttpUrl(value);
  return url && /\.m3u8(?:$|[?#])/i.test(url) ? url : null;
}

function cleanId(value: unknown): string {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function mapIowaFeature(feature: IowaFeature): CctvCamera | null {
  const row = feature?.attributes;
  if (!row) return null;

  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < IOWA_BOUNDS.minLat || lat > IOWA_BOUNDS.maxLat || lng < IOWA_BOUNDS.minLng || lng > IOWA_BOUNDS.maxLng) return null;

  const image = publicHttpUrl(row.ImageURL);
  const video = publicHttpUrl(row.VideoURL);
  const hls = hlsUrl(row.VideoURL);
  if (!image && !video) return null;

  const rawId = row.COMMON_ID || row.device_id || row.FID || `${lat.toFixed(5)}-${lng.toFixed(5)}`;
  const id = cleanId(rawId);
  if (!id) return null;

  const region = String(row.REGION ?? '').trim();
  const name = row.ImageName?.trim() || row.Desc_?.trim() || row.Route?.trim() || `Iowa DOT Camera ${id}`;

  return {
    id: `iadot-${id}`,
    lat,
    lng,
    name,
    city: region ? `Iowa DOT Region ${region}` : 'Iowa',
    country: 'US',
    source: 'Iowa DOT',
    ...(image ? { feed_url: image } : {}),
    ...(hls ? { stream_url: hls, stream_type: 'hls' as const } : {}),
    ...(!hls && video ? { external_url: video } : {}),
  };
}

function pageUrl(offset: number): string {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'FID,device_id,Desc_,Route,ImageName,ImageURL,VideoURL,ORG,latitude,longitude,REGION,COMMON_ID',
    returnGeometry: 'false',
    orderByFields: 'FID',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: 'json',
  });
  return `${ENDPOINT}?${params}`;
}

async function fetchPage(offset: number): Promise<IowaPayload> {
  const response = await fetch(pageUrl(offset), {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS/1.0' },
  });
  if (!response.ok) throw new Error(`Iowa DOT HTTP ${response.status}`);
  const payload = await response.json() as IowaPayload;
  if (payload.error) throw new Error(`Iowa DOT ArcGIS: ${payload.error.message || 'query error'}`);
  return payload;
}

/**
 * Official Iowa DOT open-data camera index.
 *
 * Iowa DOT explicitly publishes this ESRI feature service for data integrators
 * without credentials. Snapshot and video addresses changed during the 2026
 * video-system migration, so they are read live from the feature service rather
 * than baked into the repository.
 */
export async function fetchIowaCameras(): Promise<CctvCamera[]> {
  const cameras = new Map<string, CctvCamera>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await fetchPage(page * PAGE_SIZE);
    const features = Array.isArray(payload.features) ? payload.features : [];
    for (const feature of features) {
      const camera = mapIowaFeature(feature);
      if (camera) cameras.set(camera.id, camera);
    }

    if (!payload.exceededTransferLimit && features.length < PAGE_SIZE) break;
    if (features.length === 0) break;
    if (page === MAX_PAGES - 1) throw new Error('Iowa DOT camera index exceeded pagination safety limit');
  }

  if (cameras.size === 0) throw new Error('Iowa DOT camera index returned no usable cameras');
  console.log(`[OSIRIS] Iowa DOT cameras: ${cameras.size}`);
  return [...cameras.values()];
}
