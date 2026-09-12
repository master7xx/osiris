import { isNewsDigest } from './event-text';
export type EventCategory =
  | 'conflict'
  | 'protest'
  | 'political'
  | 'earthquake'
  | 'flood'
  | 'wildfire'
  | 'volcano'
  | 'weather'
  | 'cyber'
  | 'infrastructure'
  | 'aviation'
  | 'maritime'
  | 'other';

export type EventConfidence = 'unconfirmed' | 'corroborating' | 'confirmed';
export type EventSourceKind = 'editorial' | 'osint' | 'broadcaster' | 'official' | 'sensor' | 'aggregator';

export interface EventEvidence {
  transport?: 'rss' | 'telegram';
  source_id: string;
  source: string;
  kind: EventSourceKind;
  independent: boolean;
  weight: number;
  url?: string;
  published_at?: string;
}

export interface IncomingEvent {
  id: string;
  title: string;
  description?: string;
  category: EventCategory;
  occurred_at: string;
  discovered_at?: string;
  lat?: number;
  lng?: number;
  location?: string;
  location_confidence?: number;
  severity: number;
  evidence: EventEvidence[];
  tags?: string[];
  supersedes?: string[];
  withdrawn?: boolean;
  source_count_hint?: number;
  independent_sources_hint?: number;
  evidence_weight_hint?: number;
}

export interface FusedEvent {
  id: string;
  title: string;
  description: string;
  category: EventCategory;
  categories: EventCategory[];
  occurred_at: string;
  first_seen_at: string;
  last_seen_at: string;
  lat?: number;
  lng?: number;
  location?: string;
  location_confidence: number;
  severity: number;
  priority_score: number;
  confidence: EventConfidence;
  status: 'active';
  evidence: EventEvidence[];
  sources: string[];
  source_count: number;
  independent_sources: number;
  evidence_weight: number;
  urls: string[];
  tags: string[];
  supersedes?: string[];
  withdrawn?: boolean;
  age_minutes: number;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'after', 'into', 'over', 'near', 'says', 'said', 'this', 'that',
  'как', 'что', 'это', 'для', 'при', 'после', 'через', 'или', 'его', 'она', 'они', 'уже',
  'та', 'що', 'для', 'після', 'через', 'біля', 'про',
]);

const KEYWORDS: Array<{ category: EventCategory; words: string[] }> = [
  { category: 'earthquake', words: ['earthquake', 'aftershock', 'землетряс', 'землетрус'] },
  { category: 'volcano', words: ['volcano', 'eruption', 'вулкан', 'извержен', 'вивержен'] },
  { category: 'wildfire', words: ['wildfire', 'forest fire', 'bushfire', 'лесной пожар', 'лісова пожеж'] },
  { category: 'flood', words: ['flood', 'flash flood', 'наводнен', 'повін'] },
  { category: 'weather', words: ['hurricane', 'cyclone', 'typhoon', 'tornado', 'storm', 'ураган', 'тайфун', 'шторм', 'циклон'] },
  { category: 'cyber', words: ['cyberattack', 'cyber attack', 'ransomware', 'data breach', 'ddos', 'кибератак', 'кібератак'] },
  { category: 'aviation', words: ['plane crash', 'aircraft crash', 'aviation incident', 'airliner', 'авиакатастроф', 'авіакатастроф'] },
  { category: 'maritime', words: ['ship collision', 'vessel attack', 'tanker', 'cargo ship', 'морское судно', 'корабль', 'танкер'] },
  { category: 'protest', words: ['protest', 'demonstration', 'riot', 'unrest', 'митинг', 'протест', 'беспорядк', 'заворушен'] },
  { category: 'political', words: ['coup', 'election crisis', 'resign', 'impeach', 'переворот', 'выбор', 'відставк'] },
  { category: 'infrastructure', words: ['blackout', 'power outage', 'grid failure', 'bridge collapse', 'derailment', 'авария на', 'отключение электр', 'блэкаут'] },
  { category: 'conflict', words: [
    'missile', 'airstrike', 'shelling', 'artillery', 'drone attack', 'military strike', 'invasion', 'bombardment',
    'explosion', 'attack', 'война', 'ракет', 'авиаудар', 'обстрел', 'беспилот', 'взрыв', 'війна', 'ракет', 'обстріл', 'вибух',
  ] },
];

export function classifyEventText(text: string): EventCategory {
  const lower = text.toLowerCase();
  for (const group of KEYWORDS) {
    if (group.words.some(word => lower.includes(word))) return group.category;
  }
  return 'other';
}

function tokens(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 32));
}

export function eventTitleSimilarity(a: string, b: string): number {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const word of aa) if (bb.has(word)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

function toMs(value?: string): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function haversineKm(a: IncomingEvent, b: IncomingEvent): number | undefined {
  if (![a.lat, a.lng, b.lat, b.lng].every(value => typeof value === 'number' && Number.isFinite(value))) return undefined;
  const lat1 = a.lat! * Math.PI / 180;
  const lat2 = b.lat! * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (b.lng! - a.lng!) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function categoryFamily(category: EventCategory): string {
  if (['conflict', 'protest', 'political'].includes(category)) return 'human-security';
  if (['earthquake', 'flood', 'wildfire', 'volcano', 'weather'].includes(category)) return 'natural-hazard';
  if (['cyber', 'infrastructure'].includes(category)) return 'systems';
  return category;
}

function evidenceUrls(event: IncomingEvent) {
  return new Set(event.evidence.map(item => item.url).filter((url): url is string => Boolean(url)));
}

export function shouldFuseEvents(a: IncomingEvent, b: IncomingEvent): boolean {
  if (isNewsDigest(a.title, a.description) !== isNewsDigest(b.title, b.description)) return false;
  if (Boolean(a.withdrawn) !== Boolean(b.withdrawn)) return false;
  if (a.id === b.id) return true;

  const urlsA = evidenceUrls(a);
  if (b.evidence.some(item => item.url && urlsA.has(item.url))) return true;

  if (a.evidence.some(e => e.source_id === 'noaa-nws') && b.evidence.some(e => e.source_id === 'noaa-nws')) return false;

  const timeDelta = Math.abs(toMs(a.occurred_at) - toMs(b.occurred_at));
  if (!Number.isFinite(timeDelta) || timeDelta > 8 * 60 * 60_000) return false;

  const similarity = eventTitleSimilarity(a.title, b.title);
  const distance = haversineKm(a, b);
  const sameCategory = a.category === b.category;
  const sameFamily = categoryFamily(a.category) === categoryFamily(b.category);

  // Earthquake sequences can contain many real aftershocks in the same area.
  // Require either a strong title match or an extremely tight time+space match.
  if (sameCategory && a.category === 'earthquake') {
    return similarity >= 0.4 || (timeDelta <= 15 * 60_000 && distance !== undefined && distance <= 25);
  }

  if (similarity >= 0.68 && (distance === undefined || distance <= 250)) return true;
  if (!sameFamily) return false;
  if (distance !== undefined && distance <= 60 && similarity >= 0.24) return true;
  if (sameCategory && distance !== undefined && distance <= 25 && timeDelta <= 60 * 60_000) return true;
  return false;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function evidenceWeight(event: IncomingEvent) {
  if (typeof event.evidence_weight_hint === 'number' && Number.isFinite(event.evidence_weight_hint)) {
    return Math.max(event.evidence_weight_hint, event.evidence.reduce((sum, item) => sum + item.weight, 0));
  }
  return event.evidence.reduce((sum, item) => sum + item.weight, 0);
}

function choosePrimary(items: IncomingEvent[]): IncomingEvent {
  return [...items].sort((a, b) => {
    const aScore = evidenceWeight(a) * 10 + a.severity + (a.location_confidence ?? 0) * 5;
    const bScore = evidenceWeight(b) * 10 + b.severity + (b.location_confidence ?? 0) * 5;
    return bScore - aScore || toMs(b.occurred_at) - toMs(a.occurred_at);
  })[0];
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function fuseCluster(items: IncomingEvent[], now: number): FusedEvent {
  const primary = choosePrimary(items);
  const evidenceMap = new Map<string, EventEvidence>();
  for (const item of items) {
    for (const evidence of item.evidence) {
      const key = `${evidence.source_id}|${evidence.url || evidence.source}`;
      const previous = evidenceMap.get(key);
      if (!previous || evidence.weight > previous.weight) evidenceMap.set(key, evidence);
    }
  }
  const evidence = [...evidenceMap.values()];
  const sourceIds = new Set(evidence.map(item => item.source_id));
  const sourceNames = [...new Set(evidence.map(item => item.source))];
  const hintedSourceCount = Math.max(0, ...items.map(item => item.source_count_hint ?? 0));
  const sourceCount = Math.max(sourceIds.size, hintedSourceCount);
  const hintedIndependent = Math.max(0, ...items.map(item => item.independent_sources_hint ?? 0));
  const independentSources = Math.max(evidence.filter(item => item.independent).length, hintedIndependent);
  const weight = Math.max(
    evidence.reduce((sum, item) => sum + item.weight, 0),
    ...items.map(item => item.evidence_weight_hint ?? 0),
  );

  const hasAuthoritativeEvidence = evidence.some(item => item.kind === 'official' || item.kind === 'sensor');
  const confidence: EventConfidence = hasAuthoritativeEvidence || (independentSources >= 2 && weight >= 1.7)
    ? 'confirmed'
    : sourceCount >= 2 || weight >= 1.5
      ? 'corroborating'
      : 'unconfirmed';

  const locationItem = [...items]
    .filter(item => typeof item.lat === 'number' && typeof item.lng === 'number')
    .sort((a, b) => (b.location_confidence ?? 0) - (a.location_confidence ?? 0))[0];

  const occurredTimes = items.map(item => toMs(item.occurred_at)).filter(Boolean);
  const discoveredTimes = items.map(item => toMs(item.discovered_at || item.occurred_at)).filter(Boolean);
  const occurredAt = occurredTimes.length ? Math.min(...occurredTimes) : now;
  const firstSeen = discoveredTimes.length ? Math.min(...discoveredTimes) : now;
  const lastSeen = discoveredTimes.length ? Math.max(...discoveredTimes) : now;
  const severity = clamp(Math.round(Math.max(...items.map(item => item.severity))), 0, 100);
  const ageMinutes = Math.max(0, Math.round((now - occurredAt) / 60_000));
  const freshness = clamp(25 - ageMinutes / 12, 0, 25);
  const confidenceBonus = confidence === 'confirmed' ? 18 : confidence === 'corroborating' ? 9 : 0;
  const corroborationBonus = Math.min(12, independentSources * 4 + Math.max(0, sourceCount - 1) * 2);
  const priorityScore = clamp(Math.round(severity * 0.55 + freshness + confidenceBonus + corroborationBonus), 0, 100);
  const ids = items.map(item => item.id).sort();

  return {
    id: `evt-${hashString(ids.join('|'))}`,
    title: primary.title,
    description: primary.description || '',
    category: primary.category,
    categories: [...new Set(items.map(item => item.category))],
    occurred_at: new Date(occurredAt).toISOString(),
    first_seen_at: new Date(firstSeen).toISOString(),
    last_seen_at: new Date(lastSeen).toISOString(),
    ...(locationItem ? {
      lat: locationItem.lat,
      lng: locationItem.lng,
      location: locationItem.location,
    } : {}),
    location_confidence: locationItem?.location_confidence ?? 0,
    severity,
    priority_score: priorityScore,
    confidence,
    status: 'active',
    evidence,
    sources: sourceNames,
    source_count: sourceCount,
    independent_sources: independentSources,
    evidence_weight: Number(weight.toFixed(2)),
    urls: [...new Set(evidence.map(item => item.url).filter((url): url is string => Boolean(url)))],
    tags: [...new Set(items.flatMap(item => item.tags ?? []))],
    ...(items.some(item => item.supersedes?.length) ? { supersedes: [...new Set(items.flatMap(item => item.supersedes ?? []))].sort() } : {}),
    ...(items.every(item => item.withdrawn) ? { withdrawn: true } : {}),
    age_minutes: ageMinutes,
  };
}

export function fuseEvents(events: IncomingEvent[], options: { now?: number; limit?: number } = {}): FusedEvent[] {
  const now = options.now ?? Date.now();
  const valid = events
    .filter(event => event.title.trim().length >= 4 && toMs(event.occurred_at) > 0)
    .sort((a, b) => toMs(b.occurred_at) - toMs(a.occurred_at));

  const clusters: IncomingEvent[][] = [];
  for (const event of valid) {
    const cluster = clusters.find(rows => rows.some(existing => shouldFuseEvents(existing, event)));
    if (cluster) cluster.push(event);
    else clusters.push([event]);
  }

  return clusters
    .map(cluster => fuseCluster(cluster, now))
    .sort((a, b) => b.priority_score - a.priority_score || toMs(b.last_seen_at) - toMs(a.last_seen_at))
    .slice(0, options.limit ?? 300);
}
