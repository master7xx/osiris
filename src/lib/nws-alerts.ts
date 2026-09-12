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
  };
};

export type NwsResponse = {
  features?: NwsFeature[];
};


export async function fetchNwsAlerts(): Promise<NwsResponse> {
  const response = await fetch('https://api.weather.gov/alerts/active?status=actual', {
    headers: { Accept: 'application/geo+json', 'User-Agent': 'OSIRIS (https://github.com/master7xx/osiris)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`NWS HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.features)) throw new Error('Invalid NWS response');
  return data;
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
    if (!p || p.status !== 'Actual' || !['Alert', 'Update'].includes(p.messageType ?? 'Alert')) continue;
    const id = p.id || p['@id'];
    const sent = Date.parse(p.sent ?? '');
    const expires = Date.parse(p.expires ?? '');
    if (typeof id !== 'string' || !id || typeof p.event !== 'string' || !p.event || !Number.isFinite(sent) || sent > now + 60000 || !Number.isFinite(expires) || expires <= now) continue;
    const point = getRepresentativePoint(feature.geometry);
    const url = p['@id']?.startsWith('https://api.weather.gov/alerts/') ? p['@id'] : `https://api.weather.gov/alerts/${encodeURIComponent(id)}`;
    const severity = ({ Extreme: 90, Severe: 75, Moderate: 50, Minor: 25 } as Record<string, number>)[p.severity ?? ''] ?? 20;
    result.set(id, {
      id: `nws:${id}`, title: p.headline || p.event,
      description: [p.description, p.instruction].filter(Boolean).join('\n\n'),
      category: /flood/i.test(p.event) ? 'flood' : 'weather',
      occurred_at: new Date(sent).toISOString(), discovered_at: new Date(now).toISOString(),
      ...(point ? { lat: point.lat, lng: point.lng } : {}),
      location: p.areaDesc, location_confidence: point ? feature.geometry?.type === 'Point' ? 1 : 0.6 : 0,
      severity, evidence: [{ source_id: 'noaa-nws', source: 'NOAA / NWS', kind: 'official', independent: true, weight: 1.2, url, published_at: new Date(sent).toISOString() }],
      tags: ['nws', 'official-warning', `expires:${new Date(expires).toISOString()}`, ...(point && feature.geometry?.type !== 'Point' ? ['area-warning'] : [])],
    });
  }
  return [...result.values()];
}
export async function fetchNwsEvents() { return parseNwsAlerts(await fetchNwsAlerts()); }
