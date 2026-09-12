import { aggregateNews, locateArticle, type NewsItem } from './news-aggregator';
import {
  classifyEventText,
  type EventCategory,
  type EventEvidence,
  type EventSourceKind,
  type IncomingEvent,
} from './event-fusion';

export interface EventSourceHealth {
  id: string;
  label: string;
  state: 'healthy' | 'partial' | 'error';
  ok: boolean;
  duration_ms: number;
  events: number;
  source_count: number;
  healthy_sources: number;
  error?: string;
}

interface AdapterOutput {
  events: IncomingEvent[];
  source_count?: number;
  healthy_sources?: number;
  degraded?: string;
}

interface EventSourceAdapter {
  id: string;
  label: string;
  fetch: () => Promise<AdapterOutput>;
}

export interface CollectedEvents {
  events: IncomingEvent[];
  health: EventSourceHealth[];
  source_count: number;
  healthy_sources: number;
}

const NEWS_OSINT = new Set(['Conflict Intelligence Team', 'WarTranslated', 'NOELREPORTS', 'Faytuks Network', 'Liveuamap']);
const NEWS_BROADCASTERS = new Set(['BBC', 'Al Jazeera', 'Euronews']);
const NEWS_NON_INDEPENDENT = new Set(['BBC', 'Al Jazeera', 'Euronews', 'Liveuamap']);

function safeIso(value: unknown, fallback = Date.now()): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string') {
    const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (compact) {
      return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`).toISOString();
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(fallback).toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sourceSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'source';
}

function newsKind(source: string): EventSourceKind {
  if (NEWS_OSINT.has(source)) return 'osint';
  if (NEWS_BROADCASTERS.has(source)) return 'broadcaster';
  return 'editorial';
}

function newsToEvent(item: NewsItem): IncomingEvent {
  const count = Math.max(1, item.source_count || item.sources?.length || 1);
  const averageWeight = Math.max(0.4, item.evidence_weight / count);
  const sources = item.sources?.length ? item.sources : [item.source];
  const evidence: EventEvidence[] = sources.map(source => ({
    source_id: `news:${sourceSlug(source)}`,
    source,
    kind: newsKind(source),
    independent: !NEWS_NON_INDEPENDENT.has(source),
    weight: averageWeight,
    ...(source === item.source && item.link ? { url: item.link } : {}),
    published_at: item.published,
  }));
  const text = `${item.title} ${item.description}`;
  const category = classifyEventText(text);
  const coords = item.coords;
  return {
    id: `news:${item.id}`,
    title: item.title,
    description: item.description,
    category,
    occurred_at: item.published,
    discovered_at: new Date().toISOString(),
    ...(coords ? { lat: coords[0], lng: coords[1] } : {}),
    location: item.location,
    location_confidence: item.location_confidence,
    severity: clamp(Math.round((item.risk_score || 1) * 9 + (item.confidence === 'high' ? 8 : item.confidence === 'medium' ? 4 : 0)), 10, 100),
    evidence,
    source_count_hint: item.source_count,
    independent_sources_hint: item.independent_sources,
    evidence_weight_hint: item.evidence_weight,
    tags: ['news', item.confidence],
  };
}

async function fetchNewsEvents(): Promise<AdapterOutput> {
  const result = await aggregateNews();
  return {
    events: result.news.map(newsToEvent),
    source_count: result.source_count,
    healthy_sources: result.healthy_sources,
    degraded: result.degraded_sources || result.cooldown_sources
      ? `${result.degraded_sources} degraded, ${result.cooldown_sources} cooldown`
      : undefined,
  };
}

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

interface GdeltPayload {
  articles?: GdeltArticle[];
}

const GDELT_QUERIES = [
  '(attack OR explosion OR missile OR drone OR airstrike OR shelling OR coup)',
  '(protest OR riot OR unrest OR evacuation OR emergency)',
  '(earthquake OR flood OR wildfire OR eruption OR cyclone OR hurricane OR tsunami)',
  '(blackout OR power outage OR cyberattack OR derailment OR bridge collapse)',
];

function eventSeverity(category: EventCategory, title: string): number {
  const base: Record<EventCategory, number> = {
    conflict: 72,
    protest: 52,
    political: 48,
    earthquake: 65,
    flood: 58,
    wildfire: 55,
    volcano: 68,
    weather: 55,
    cyber: 60,
    infrastructure: 58,
    aviation: 70,
    maritime: 58,
    other: 35,
  };
  const urgent = /breaking|urgent|major|massive|dead|killed|evacuat|срочно|погиб|эвакуац/i.test(title) ? 10 : 0;
  return clamp(base[category] + urgent, 0, 100);
}

function decodeText(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseGdeltArticles(payload: unknown, now = Date.now()): IncomingEvent[] {
  const rows = Array.isArray((payload as GdeltPayload | null)?.articles)
    ? (payload as GdeltPayload).articles!
    : [];
  const out: IncomingEvent[] = [];
  for (const row of rows) {
    const title = decodeText(row.title || '');
    const url = row.url?.trim();
    if (title.length < 8 || !url) continue;
    const category = classifyEventText(title);
    const location = locateArticle(title);
    const domain = row.domain?.trim() || 'unknown-domain';
    const occurred = safeIso(row.seendate, now);
    out.push({
      id: `gdelt:${sourceSlug(domain)}:${sourceSlug(url)}`,
      title,
      description: '',
      category,
      occurred_at: occurred,
      discovered_at: new Date(now).toISOString(),
      ...(location.coords ? { lat: location.coords[0], lng: location.coords[1] } : {}),
      location: location.location,
      location_confidence: location.confidence,
      severity: eventSeverity(category, title),
      evidence: [{
        source_id: `gdelt:${sourceSlug(domain)}`,
        source: `GDELT / ${domain}`,
        kind: 'aggregator',
        independent: false,
        weight: 0.65,
        url,
        published_at: occurred,
      }],
      tags: ['gdelt', row.language || '', row.sourcecountry || ''].filter(Boolean),
    });
  }
  return out;
}

async function fetchGdeltEvents(): Promise<AdapterOutput> {
  const results = await Promise.allSettled(GDELT_QUERIES.map(async query => {
    const params = new URLSearchParams({
      query,
      mode: 'ArtList',
      maxrecords: '50',
      format: 'json',
      sort: 'datedesc',
      timespan: '3h',
    });
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS/1.0' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GDELT HTTP ${response.status}`);
    return parseGdeltArticles(await response.json());
  }));

  const events = new Map<string, IncomingEvent>();
  let failed = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      failed += 1;
      continue;
    }
    for (const event of result.value) {
      const url = event.evidence[0]?.url || event.id;
      if (!events.has(url)) events.set(url, event);
    }
  }
  if (failed === results.length) throw new Error('all GDELT discovery queries failed');
  return {
    events: [...events.values()],
    source_count: 1,
    healthy_sources: 1,
    degraded: failed ? `${failed}/${results.length} discovery queries failed` : undefined,
  };
}

function xmlTag(block: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  if (!match) return '';
  return decodeText(match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
}

function gdacsCategory(type: string): EventCategory {
  if (type === 'EQ') return 'earthquake';
  if (type === 'TC') return 'weather';
  if (type === 'FL') return 'flood';
  if (type === 'VO') return 'volcano';
  if (type === 'WF') return 'wildfire';
  return 'other';
}

function gdacsSeverity(level: string, category: EventCategory) {
  if (/red/i.test(level)) return 92;
  if (/orange/i.test(level)) return 75;
  if (/green/i.test(level)) return 50;
  return eventSeverity(category, '');
}

export function parseGdacsRss(xml: string, now = Date.now()): IncomingEvent[] {
  const out: IncomingEvent[] = [];
  for (const chunk of xml.split(/<item>/i).slice(1)) {
    const item = chunk.split(/<\/item>/i)[0];
    const title = xmlTag(item, 'title');
    const latText = xmlTag(item, 'geo:lat');
    const lngText = xmlTag(item, 'geo:long');
    if (!title || !latText || !lngText) continue;
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const eventType = xmlTag(item, 'gdacs:eventtype') || 'UNK';
    const eventId = xmlTag(item, 'gdacs:eventid') || `${lat}-${lng}-${title}`;
    const category = gdacsCategory(eventType);
    const occurred = safeIso(xmlTag(item, 'gdacs:fromdate') || xmlTag(item, 'pubDate'), now);
    const link = xmlTag(item, 'link');
    const alert = xmlTag(item, 'gdacs:alertlevel');
    out.push({
      id: `gdacs:${eventType}:${eventId}`,
      title,
      description: xmlTag(item, 'description'),
      category,
      occurred_at: occurred,
      discovered_at: new Date(now).toISOString(),
      lat,
      lng,
      location: xmlTag(item, 'gdacs:country') || undefined,
      location_confidence: 1,
      severity: gdacsSeverity(alert, category),
      evidence: [{
        source_id: 'gdacs',
        source: 'GDACS',
        kind: 'official',
        independent: true,
        weight: 1.3,
        ...(link ? { url: link } : {}),
        published_at: occurred,
      }],
      tags: ['gdacs', eventType, alert].filter(Boolean),
    });
  }
  return out;
}

async function fetchGdacsEvents(): Promise<AdapterOutput> {
  const response = await fetch('https://www.gdacs.org/xml/rss.xml', {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/rss+xml,application/xml,text/xml', 'User-Agent': 'OSIRIS/1.0' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`GDACS HTTP ${response.status}`);
  return { events: parseGdacsRss(await response.text()), source_count: 1, healthy_sources: 1 };
}

interface UsgsFeature {
  id?: string;
  geometry?: { coordinates?: number[] };
  properties?: {
    mag?: number;
    place?: string;
    time?: number;
    updated?: number;
    url?: string;
    tsunami?: number;
    alert?: string | null;
    type?: string;
  };
}

interface UsgsPayload { features?: UsgsFeature[] }

function earthquakeSeverity(magnitude: number, tsunami: boolean, alert?: string | null) {
  let severity = magnitude >= 7 ? 96 : magnitude >= 6 ? 88 : magnitude >= 5 ? 76 : magnitude >= 4 ? 62 : magnitude >= 3 ? 48 : 36;
  if (tsunami) severity += 8;
  if (alert === 'red') severity = Math.max(severity, 95);
  else if (alert === 'orange') severity = Math.max(severity, 82);
  return clamp(severity, 0, 100);
}

export function parseUsgsEarthquakes(payload: unknown, now = Date.now()): IncomingEvent[] {
  const rows = Array.isArray((payload as UsgsPayload | null)?.features)
    ? (payload as UsgsPayload).features!
    : [];
  const out: IncomingEvent[] = [];
  for (const row of rows) {
    const coords = row.geometry?.coordinates;
    const props = row.properties;
    const magnitude = Number(props?.mag);
    if (!row.id || !coords || coords.length < 2 || !Number.isFinite(magnitude)) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const place = props?.place?.trim() || 'Unknown location';
    const occurred = safeIso(props?.time, now);
    const url = props?.url?.trim();
    out.push({
      id: `usgs:${row.id}`,
      title: `M${magnitude.toFixed(1)} earthquake — ${place}`,
      description: props?.alert ? `USGS alert: ${props.alert}` : '',
      category: 'earthquake',
      occurred_at: occurred,
      discovered_at: safeIso(props?.updated, now),
      lat,
      lng,
      location: place,
      location_confidence: 1,
      severity: earthquakeSeverity(magnitude, Boolean(props?.tsunami), props?.alert),
      evidence: [{
        source_id: 'usgs-earthquakes',
        source: 'USGS Earthquakes',
        kind: 'sensor',
        independent: true,
        weight: 1.5,
        ...(url ? { url } : {}),
        published_at: occurred,
      }],
      tags: ['usgs', `magnitude:${magnitude.toFixed(1)}`, props?.tsunami ? 'tsunami' : ''].filter(Boolean),
    });
  }
  return out;
}

async function fetchUsgsEarthquakeEvents(): Promise<AdapterOutput> {
  const response = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/geo+json,application/json', 'User-Agent': 'OSIRIS/1.0' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`USGS HTTP ${response.status}`);
  return { events: parseUsgsEarthquakes(await response.json()), source_count: 1, healthy_sources: 1 };
}

export const DEFAULT_EVENT_SOURCE_ADAPTERS: EventSourceAdapter[] = [
  { id: 'news', label: 'News + Telegram', fetch: fetchNewsEvents },
  { id: 'gdelt-doc', label: 'GDELT Global Discovery', fetch: fetchGdeltEvents },
  { id: 'gdacs', label: 'GDACS Disasters', fetch: fetchGdacsEvents },
  { id: 'usgs-earthquakes', label: 'USGS Earthquakes', fetch: fetchUsgsEarthquakeEvents },
];

export async function collectEventSources(adapters = DEFAULT_EVENT_SOURCE_ADAPTERS): Promise<CollectedEvents> {
  const results = await Promise.all(adapters.map(async adapter => {
    const started = performance.now();
    try {
      const output = await adapter.fetch();
      const duration = Math.round(performance.now() - started);
      const sourceCount = output.source_count ?? 1;
      const healthySources = output.healthy_sources ?? sourceCount;
      return {
        events: output.events,
        source_count: sourceCount,
        healthy_sources: healthySources,
        health: {
          id: adapter.id,
          label: adapter.label,
          state: output.degraded ? 'partial' as const : 'healthy' as const,
          ok: true,
          duration_ms: duration,
          events: output.events.length,
          source_count: sourceCount,
          healthy_sources: healthySources,
          error: output.degraded,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        events: [] as IncomingEvent[],
        source_count: 1,
        healthy_sources: 0,
        health: {
          id: adapter.id,
          label: adapter.label,
          state: 'error' as const,
          ok: false,
          duration_ms: Math.round(performance.now() - started),
          events: 0,
          source_count: 1,
          healthy_sources: 0,
          error: message,
        },
      };
    }
  }));

  return {
    events: results.flatMap(result => result.events),
    health: results.map(result => result.health),
    source_count: results.reduce((sum, result) => sum + result.source_count, 0),
    healthy_sources: results.reduce((sum, result) => sum + result.healthy_sources, 0),
  };
}
