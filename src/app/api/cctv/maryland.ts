type MarylandFeature = {
  attributes?: {
    OBJECTID?: number | string;
    location?: string;
    county?: string;
    feedID?: string;
    url?: string;
    iframe?: string;
    lat?: number | string;
    long?: number | string;
  };
};

export interface MarylandCamera {
  id: string;
  lat: number;
  lng: number;
  name: string;
  city: string;
  country: 'US';
  source: 'MDOT CHART / MD iMAP';
  external_url: string;
  feed_url?: string;
  stream_url?: string;
  stream_type?: 'iframe';
}

const ENDPOINT =
  'https://mdgeodata.md.gov/imap/rest/services/Transportation/MD_TrafficCameras/MapServer/0/query' +
  '?where=1%3D1' +
  '&outFields=OBJECTID%2Clocation%2Ccounty%2CfeedID%2Curl%2Ciframe%2Clat%2Clong' +
  '&returnGeometry=false&f=json';

function httpUrl(value?: string): string | null {
  if (!value) return null;
  const cleaned = value.replace(/&amp;/gi, '&').trim();
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function iframeSrc(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  return httpUrl(match?.[1]);
}

function snapshotUrl(value?: string): string | null {
  const url = httpUrl(value);
  if (!url) return null;
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url) ? url : null;
}

export function parseMarylandFeatures(payload: unknown): MarylandCamera[] {
  const features = (payload as { features?: MarylandFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const cameras: MarylandCamera[] = [];
  for (const feature of features) {
    const row = feature?.attributes;
    if (!row) continue;

    const lat = Number(row.lat);
    const lng = Number(row.long);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const iframe = iframeSrc(row.iframe);
    const publicUrl = httpUrl(row.url) || iframe;
    if (!publicUrl) continue;

    const key = String(row.feedID || row.OBJECTID || `${lat.toFixed(5)}-${lng.toFixed(5)}`)
      .replace(/[^a-zA-Z0-9_-]+/g, '-');
    const camera: MarylandCamera = {
      id: `mdchart-${key}`,
      lat,
      lng,
      name: row.location?.trim() || `Maryland CHART Camera ${row.feedID || row.OBJECTID || ''}`.trim(),
      city: row.county?.trim() ? `${row.county.trim()} County` : 'Maryland',
      country: 'US',
      source: 'MDOT CHART / MD iMAP',
      external_url: publicUrl,
    };

    const snapshot = snapshotUrl(row.url);
    if (snapshot) camera.feed_url = snapshot;
    if (iframe) {
      camera.stream_url = iframe;
      camera.stream_type = 'iframe';
    }

    cameras.push(camera);
  }

  return cameras;
}

/**
 * Maryland's official MD iMAP/CHART camera index.
 *
 * The ArcGIS service is public, requires no key, includes WGS84 lat/lon fields,
 * and publishes a live-camera URL for each record. Do not infer a JPEG feed
 * from a viewer page: only URLs that explicitly look like images become
 * `feed_url`; the rest stay as an iframe or external viewer.
 */
export async function fetchMarylandCameras(): Promise<MarylandCamera[]> {
  try {
    const response = await fetch(ENDPOINT, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS/1.0' },
      cache: 'no-store',
    });
    if (!response.ok) {
      console.warn(`[OSIRIS] Maryland CHART returned ${response.status} — absent from this refresh`);
      return [];
    }
    return parseMarylandFeatures(await response.json());
  } catch (error) {
    console.warn('[OSIRIS] Maryland CHART cameras failed — absent from this refresh:', error instanceof Error ? error.message : error);
    return [];
  }
}
