import { centroidFor } from './countryCentroids';
import type { EventCategory, IncomingEvent } from './event-fusion';
import type { EventSourceHealth } from './event-sources';

export interface SupplementalEventSignals {
  events: IncomingEvent[];
  health: EventSourceHealth[];
  source_count: number;
  healthy_sources: number;
}

interface SignalAdapter {
  id: string;
  label: string;
  fetch: () => Promise<IncomingEvent[]>;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function iso(value: unknown, fallback = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(fallback).toISOString();
}

function recentEnough(value: string, now: number, maxAgeMs = 7 * 24 * 60 * 60_000) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now + 60 * 60_000 && now - parsed <= maxAgeMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// NASA EONET — curated natural events
// ─────────────────────────────────────────────────────────────────────────────

interface EonetCategory { id?: string; title?: string }
interface EonetSource { id?: string; url?: string }
interface EonetGeometry { date?: string; type?: string; coordinates?: unknown; magnitudeValue?: number; magnitudeUnit?: string }
interface EonetEvent {
  id?: string;
  title?: string;
  description?: string;
  link?: string;
  categories?: EonetCategory[];
  sources?: EonetSource[];
  geometry?: EonetGeometry[];
}
interface EonetPayload { events?: EonetEvent[] }

function eonetCategory(categories: EonetCategory[] = []): EventCategory {
  const joined = categories.map(item => `${item.id || ''} ${item.title || ''}`.toLowerCase()).join(' ');
  if (/wildfire|fire/.test(joined)) return 'wildfire';
  if (/volcan/.test(joined)) return 'volcano';
  if (/flood/.test(joined)) return 'flood';
  if (/earthquake/.test(joined)) return 'earthquake';
  if (/storm|cyclone|hurricane|typhoon|tornado|drought|temperature|snow|ice|dust|haze/.test(joined)) return 'weather';
  if (/manmade|industrial/.test(joined)) return 'infrastructure';
  return 'other';
}

function flattenCoordinatePairs(value: unknown, out: Array<[number, number]>) {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
  ) {
    const lng = value[0];
    const lat = value[1];
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) out.push([lng, lat]);
    return;
  }
  for (const child of value) flattenCoordinatePairs(child, out);
}

function geometryCenter(geometry?: EonetGeometry): { lat: number; lng: number; confidence: number } | null {
  const pairs: Array<[number, number]> = [];
  flattenCoordinatePairs(geometry?.coordinates, pairs);
  if (!pairs.length) return null;
  const lng = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const lat = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  return { lat, lng, confidence: pairs.length === 1 ? 0.98 : 0.78 };
}

function naturalSeverity(category: EventCategory, geometry: EonetGeometry, updates: number) {
  const base: Partial<Record<EventCategory, number>> = {
    wildfire: 58,
    volcano: 68,
    flood: 60,
    earthquake: 66,
    weather: 57,
    infrastructure: 58,
    other: 42,
  };
  const magnitude = typeof geometry.magnitudeValue === 'number' && Number.isFinite(geometry.magnitudeValue)
    ? Math.min(14, Math.max(0, geometry.magnitudeValue) * 1.5)
    : 0;
  const persistence = Math.min(12, Math.log2(Math.max(1, updates)) * 3);
  return clamp(Math.round((base[category] ?? 42) + magnitude + persistence), 0, 100);
}

export function parseEonetEvents(payload: unknown, now = Date.now()): IncomingEvent[] {
  const rows = Array.isArray((payload as EonetPayload | null)?.events)
    ? (payload as EonetPayload).events!
    : [];
  const out: IncomingEvent[] = [];

  for (const row of rows) {
    if (!row.id || !row.title || !Array.isArray(row.geometry) || row.geometry.length === 0) continue;
    const geometry = row.geometry[row.geometry.length - 1];
    const occurred = iso(geometry.date, now);
    if (!recentEnough(occurred, now)) continue;
    const center = geometryCenter(geometry);
    if (!center) continue;
    const category = eonetCategory(row.categories);
    const externalUrl = row.sources?.find(source => source.url)?.url || row.link;
    const categoryLabel = row.categories?.map(item => item.title || item.id).filter(Boolean).join(', ');

    out.push({
      id: `eonet:${row.id}`,
      title: row.title,
      description: row.description || categoryLabel || 'NASA EONET open natural event',
      category,
      occurred_at: occurred,
      discovered_at: new Date(now).toISOString(),
      lat: center.lat,
      lng: center.lng,
      location_confidence: center.confidence,
      severity: naturalSeverity(category, geometry, row.geometry.length),
      evidence: [{
        source_id: 'nasa-eonet',
        source: 'NASA EONET',
        kind: 'official',
        independent: true,
        weight: 1.2,
        ...(externalUrl ? { url: externalUrl } : {}),
        published_at: occurred,
      }],
      tags: ['eonet', ...(row.categories?.map(item => item.id || item.title || '').filter(Boolean) ?? [])],
    });
  }
  return out;
}

async function fetchEonetEvents(): Promise<IncomingEvent[]> {
  const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=150', {
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS/1.0' },
  });
  if (!response.ok) throw new Error(`NASA EONET HTTP ${response.status}`);
  return parseEonetEvents(await response.json());
}

// ─────────────────────────────────────────────────────────────────────────────
// NASA FIRMS — turn raw hotspots into meaningful fire clusters
// ─────────────────────────────────────────────────────────────────────────────

interface FireCluster {
  key: string;
  count: number;
  sumLat: number;
  sumLng: number;
  totalFrp: number;
  maxFrp: number;
  maxBrightness: number;
  latestAt: string;
}

const FIRMS_SOURCES = [
  {
    url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
    label: 'NASA FIRMS VIIRS',
    id: 'viirs',
  },
  {
    url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
    label: 'NASA FIRMS MODIS',
    id: 'modis',
  },
];

function csvIndex(header: string[], name: string) {
  return header.findIndex(value => value.trim().toLowerCase() === name);
}

function acquisitionIso(date: string, rawTime: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const hhmm = rawTime.replace(/\D/g, '').padStart(4, '0').slice(-4);
  if (!/^\d{4}$/.test(hhmm)) return '';
  const candidate = `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function fireSeverity(cluster: FireCluster) {
  const density = Math.min(24, Math.log2(cluster.count + 1) * 6);
  const energy = Math.min(28, Math.log10(cluster.totalFrp + 1) * 11);
  return clamp(Math.round(34 + density + energy), 35, 94);
}

export function clusterFirmsCsv(csv: string, sourceId = 'viirs', sourceLabel = 'NASA FIRMS VIIRS'): IncomingEvent[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(value => value.trim().toLowerCase());
  const latIdx = csvIndex(header, 'latitude');
  const lngIdx = csvIndex(header, 'longitude');
  const dateIdx = csvIndex(header, 'acq_date');
  const timeIdx = csvIndex(header, 'acq_time');
  const frpIdx = csvIndex(header, 'frp');
  const brightIdx = csvIndex(header, 'bright_ti4') >= 0 ? csvIndex(header, 'bright_ti4') : csvIndex(header, 'brightness');
  if ([latIdx, lngIdx, dateIdx, timeIdx].some(index => index < 0)) return [];

  const cellDegrees = 0.75;
  const clusters = new Map<string, FireCluster>();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    const lat = Number(cols[latIdx]);
    const lng = Number(cols[lngIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const acquired = acquisitionIso(cols[dateIdx] || '', cols[timeIdx] || '');
    if (!acquired) continue;
    const latCell = Math.floor((lat + 90) / cellDegrees);
    const lngCell = Math.floor((lng + 180) / cellDegrees);
    const key = `${latCell}:${lngCell}`;
    const frp = Math.max(0, Number(cols[frpIdx]) || 0);
    const brightness = Math.max(0, Number(cols[brightIdx]) || 0);
    const current = clusters.get(key) ?? {
      key,
      count: 0,
      sumLat: 0,
      sumLng: 0,
      totalFrp: 0,
      maxFrp: 0,
      maxBrightness: 0,
      latestAt: acquired,
    };
    current.count += 1;
    current.sumLat += lat;
    current.sumLng += lng;
    current.totalFrp += frp;
    current.maxFrp = Math.max(current.maxFrp, frp);
    current.maxBrightness = Math.max(current.maxBrightness, brightness);
    if (Date.parse(acquired) > Date.parse(current.latestAt)) current.latestAt = acquired;
    clusters.set(key, current);
  }

  return [...clusters.values()]
    .filter(cluster => cluster.count >= 3 || cluster.totalFrp >= 25 || cluster.maxFrp >= 20)
    .map(cluster => {
      const lat = cluster.sumLat / cluster.count;
      const lng = cluster.sumLng / cluster.count;
      const severity = fireSeverity(cluster);
      return {
        id: `firms:${sourceId}:${cluster.key}:${cluster.latestAt.slice(0, 10)}`,
        title: `Active fire cluster · ${cluster.count} satellite detections`,
        description: `${sourceLabel}: total FRP ${cluster.totalFrp.toFixed(1)} MW; peak FRP ${cluster.maxFrp.toFixed(1)} MW.`,
        category: 'wildfire' as const,
        occurred_at: cluster.latestAt,
        discovered_at: new Date().toISOString(),
        lat,
        lng,
        location_confidence: 0.9,
        severity,
        evidence: [{
          source_id: `nasa-firms-${sourceId}`,
          source: sourceLabel,
          kind: 'sensor' as const,
          independent: true,
          weight: 1.3,
          url: 'https://firms.modaps.eosdis.nasa.gov/',
          published_at: cluster.latestAt,
        }],
        tags: ['firms', sourceId, `detections:${cluster.count}`],
      } satisfies IncomingEvent;
    })
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 120);
}

async function fetchFirmsEvents(): Promise<IncomingEvent[]> {
  const errors: string[] = [];
  for (const source of FIRMS_SOURCES) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
        headers: { Accept: 'text/csv,text/plain', 'User-Agent': 'OSIRIS/1.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const events = clusterFirmsCsv(text, source.id, source.label);
      if (events.length) return events;
      errors.push(`${source.id}: empty`);
    } catch (error) {
      errors.push(`${source.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`NASA FIRMS unavailable (${errors.join('; ')})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Radar — optional internet outage signals
// ─────────────────────────────────────────────────────────────────────────────

interface RawCloudflareAnnotation {
  id?: string;
  locations?: string[];
  locationsDetails?: Array<{ code?: string; name?: string }>;
  scope?: string;
  eventType?: string;
  outage?: { outageCause?: string; outageType?: string };
  description?: string;
  startDate?: string;
  endDate?: string | null;
  linkedUrl?: string;
}

interface CloudflarePayload {
  result?: { annotations?: RawCloudflareAnnotation[] };
  annotations?: RawCloudflareAnnotation[];
}

export function parseCloudflareOutages(payload: unknown, now = Date.now()): IncomingEvent[] {
  const typed = payload as CloudflarePayload | null;
  const annotations = typed?.result?.annotations ?? typed?.annotations ?? [];
  const out: IncomingEvent[] = [];
  for (const annotation of annotations) {
    const details = new Map<string, string>();
    for (const item of annotation.locationsDetails ?? []) {
      if (item.code) details.set(item.code.toUpperCase(), item.name || item.code);
    }
    const start = iso(annotation.startDate, now);
    const ended = Boolean(annotation.endDate);
    if (ended && !recentEnough(iso(annotation.endDate, now), now)) continue;

    for (const rawCode of annotation.locations ?? []) {
      const code = rawCode.toUpperCase();
      const centroid = centroidFor(code);
      if (!centroid) continue;
      const country = details.get(code) || code;
      const cause = annotation.outage?.outageCause || annotation.outage?.outageType || '';
      const severeCause = /government|power|cable|natural/i.test(cause) ? 8 : 0;
      const severity = clamp((ended ? 48 : 65) + severeCause, 0, 90);
      out.push({
        id: `cloudflare-outage:${annotation.id || start}:${code}`,
        title: `${ended ? 'Internet disruption' : 'Ongoing internet disruption'} — ${country}`,
        description: [annotation.description, cause, annotation.scope].filter(Boolean).join(' · '),
        category: 'infrastructure',
        occurred_at: start,
        discovered_at: new Date(now).toISOString(),
        lat: centroid[1],
        lng: centroid[0],
        location: country,
        // Country centroid is intentionally not precise enough for map-event placement.
        location_confidence: 0.45,
        severity,
        evidence: [{
          source_id: 'cloudflare-radar-outages',
          source: 'Cloudflare Radar',
          kind: 'sensor',
          independent: true,
          weight: 1.25,
          ...(annotation.linkedUrl ? { url: annotation.linkedUrl } : {}),
          published_at: start,
        }],
        tags: ['internet-outage', code, ended ? 'ended' : 'ongoing', annotation.eventType || ''].filter(Boolean),
      });
    }
  }
  return out;
}

async function fetchCloudflareOutages(): Promise<IncomingEvent[]> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) return [];
  const response = await fetch('https://api.cloudflare.com/client/v4/radar/annotations/outages?limit=50&format=json', {
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Cloudflare Radar HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.success === false) {
    throw new Error(payload?.errors?.[0]?.message || 'Cloudflare Radar rejected request');
  }
  return parseCloudflareOutages(payload);
}

async function runAdapter(adapter: SignalAdapter): Promise<{ events: IncomingEvent[]; health: EventSourceHealth }> {
  const started = performance.now();
  try {
    const events = await adapter.fetch();
    return {
      events,
      health: {
        id: adapter.id,
        label: adapter.label,
        state: 'healthy',
        ok: true,
        duration_ms: Math.round(performance.now() - started),
        events: events.length,
        source_count: 1,
        healthy_sources: 1,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      events: [],
      health: {
        id: adapter.id,
        label: adapter.label,
        state: 'error',
        ok: false,
        duration_ms: Math.round(performance.now() - started),
        events: 0,
        source_count: 1,
        healthy_sources: 0,
        error: message,
      },
    };
  }
}

export async function collectSupplementalEventSignals(): Promise<SupplementalEventSignals> {
  const adapters: SignalAdapter[] = [
    { id: 'nasa-eonet', label: 'NASA EONET', fetch: fetchEonetEvents },
    { id: 'nasa-firms', label: 'NASA FIRMS', fetch: fetchFirmsEvents },
  ];
  if (process.env.CLOUDFLARE_API_TOKEN?.trim()) {
    adapters.push({ id: 'cloudflare-radar-outages', label: 'Cloudflare Radar Outages', fetch: fetchCloudflareOutages });
  }

  const results = await Promise.all(adapters.map(runAdapter));
  return {
    events: results.flatMap(result => result.events),
    health: results.map(result => result.health),
    source_count: results.length,
    healthy_sources: results.filter(result => result.health.ok).length,
  };
}
