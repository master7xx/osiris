import type { IncomingEvent } from './event-fusion';
export type NwsGeometry =
  | {
      type: 'Point';
      coordinates: number[];
    }
  | {
      type: 'Polygon';
      coordinates?: number[][][];
    }
  | {
      type: 'MultiPolygon';
      coordinates?: number[][][][];
    };

export type NwsFeature = {
  geometry?: NwsGeometry | null;
  properties?: {
    '@id'?: string;
    id?: string;
    headline?: string;
    event?: string;
    severity?: string;
    effective?: string;
    sent?: string;
    expires?: string;
    areaDesc?: string;
    description?: string;
    instruction?: string;
    status?: string;
    messageType?: string;
    references?: { identifier?: string; '@id'?: string; sent?: string }[];
  };
};

export type NwsResponse = {
  features?: NwsFeature[];
};


async function fetchNwsCollection(initial: string): Promise<NwsResponse> {
  const signal = AbortSignal.timeout(15000);
  const features: NwsFeature[] = [];
  const seen = new Set<string>();
  let next: string | undefined = initial;
  for (let page = 0; next && page < 20; page++) {
    const url: URL = new URL(next);
    if (url.protocol !== 'https:' || url.hostname !== 'api.weather.gov' || url.username || url.password || url.port || !/^\/alerts(?:\/active)?$/.test(url.pathname) || seen.has(url.href)) throw new Error('Invalid NWS pagination');
    seen.add(url.href);
    const response: Response = await fetch(url.href, {
      headers: { Accept: 'application/geo+json', 'User-Agent': 'OSIRIS (https://github.com/master7xx/osiris)' }, signal,
    });
    if (!response.ok) throw new Error(`NWS HTTP ${response.status}`);
    const data: { features?: NwsFeature[]; pagination?: { next?: unknown } } = await response.json();
    if (!data || !Array.isArray(data.features)) throw new Error('Invalid NWS response');
    features.push(...data.features);
    const following = data.pagination?.next;
    if (following !== undefined && typeof following !== 'string') throw new Error('Invalid NWS pagination');
    next = following;
  }
  if (next) throw new Error('NWS pagination limit exceeded');
  return { features };
}
export function fetchNwsAlerts(): Promise<NwsResponse> {
  return fetchNwsCollection('https://api.weather.gov/alerts/active?status=actual');
}

export function getRepresentativePoint(geometry?: NwsGeometry | null) {
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates;
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }

  if (geometry.type === 'Polygon') {
    return averageCoordinates(geometry.coordinates?.[0]);
  }

  if (geometry.type === 'MultiPolygon') {
    return averageCoordinates(geometry.coordinates?.[0]?.[0]);
  }

  return null;
}

function averageCoordinates(coords?: number[][]) {
  if (!coords || coords.length === 0 || coords.some(c => !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) return null;

  const totals = coords.reduce(
    (acc, coord) => {
      acc.lng += coord[0];
      acc.lat += coord[1];
      return acc;
    },
    { lat: 0, lng: 0 }
  );

  return {
    lat: totals.lat / coords.length,
    lng: totals.lng / coords.length,
  };
}

/** CAP messages keep their upstream identity; no guessed city/zone coordinates. */
export function parseNwsAlerts(data: NwsResponse, now = Date.now()): IncomingEvent[] {
  const result = new Map<string, IncomingEvent>();
  for (const feature of data.features ?? []) {
    const p = feature?.properties;
    if (!p || p.status !== 'Actual' || !['Alert', 'Update', 'Cancel'].includes(p.messageType ?? 'Alert')) continue;
    const id = p.id || p['@id'];
    const sent = Date.parse(p.sent ?? '');
    const expires = Date.parse(p.expires ?? '');
    if (typeof id !== 'string' || !id || typeof p.event !== 'string' || !p.event || !Number.isFinite(sent) || sent > now + 60000) continue;
    const references = (Array.isArray(p.references) ? p.references : []).flatMap(ref => {
      const value = ref?.identifier || ref?.['@id'];
      if (typeof value !== 'string' || !value || (ref.sent && Date.parse(ref.sent) > sent)) return [];
      return [value.startsWith('https://api.weather.gov/alerts/') ? value : `https://api.weather.gov/alerts/${encodeURIComponent(value)}`];
    });
    const cancellation = p.messageType === 'Cancel';
    const expired = !Number.isFinite(expires) || expires <= now;
    // Expired updates still carry lineage needed to retire older warnings.
    if ((cancellation || expired) && (!references.length || sent < now - 48 * 3600000)) continue;
    const point = getRepresentativePoint(feature.geometry);
    const url = p['@id']?.startsWith('https://api.weather.gov/alerts/') ? p['@id'] : `https://api.weather.gov/alerts/${encodeURIComponent(id)}`;
    const severity = ({ Extreme: 90, Severe: 75, Moderate: 50, Minor: 25 } as Record<string, number>)[p.severity ?? ''] ?? 20;
    result.set(id, {
      ...(references.length ? { supersedes: references } : {}),
      ...(cancellation || expired ? { withdrawn: true } : {}),
      id: `nws:${id}`, title: p.headline || p.event,
      description: [p.description, p.instruction].filter(Boolean).join('\n\n'),
      category: /flood/i.test(p.event) ? 'flood' : 'weather',
      occurred_at: new Date(sent).toISOString(), discovered_at: new Date(now).toISOString(),
      ...(point ? { lat: point.lat, lng: point.lng } : {}),
      location: p.areaDesc, location_confidence: point ? feature.geometry?.type === 'Point' ? 1 : 0.6 : 0,
      severity, evidence: [{ source_id: 'noaa-nws', source: 'NOAA / NWS', kind: 'official', independent: true, weight: 1.2, url, published_at: new Date(sent).toISOString() }],
      tags: ['nws', 'official-warning', ...(Number.isFinite(expires) ? [`expires:${new Date(expires).toISOString()}`] : []), ...(point && feature.geometry?.type !== 'Point' ? ['area-warning'] : [])],
    });
  }
  return [...result.values()];
}
export async function fetchNwsEvents() {
  const now = Date.now();
  const [active, recent] = await Promise.all([
    fetchNwsAlerts(),
    fetchNwsCollection(`https://api.weather.gov/alerts?status=actual&start=${encodeURIComponent(new Date(now - 48 * 3600000).toISOString())}`),
  ]);
  // Commit a coherent refresh only after both collections have succeeded.
  return parseNwsAlerts({ features: [...(recent.features ?? []), ...(active.features ?? [])] }, now);
}
