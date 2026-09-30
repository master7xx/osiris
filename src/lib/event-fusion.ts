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
  /** Provider-scoped identity when the URL names a collection. */
  upstream_id?: string;
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
  /** Historical record replaced by durable child UUIDs. */
  replaced_by?: string[];
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
  /** Historical record replaced by durable child UUIDs. */
  replaced_by?: string[];
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
  return tokenSimilarity(tokens(a), tokens(b));
}

function tokenSimilarity(aa: Set<string>, bb: Set<string>): number {
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

export function isNewsEvent(event: IncomingEvent): boolean {
  return event.evidence.some(item => item.source_id.startsWith('news:') || item.transport === 'rss' || item.transport === 'telegram');
}

interface PreparedEvent {
  event: IncomingEvent;
  digest: boolean;
  time: number;
  words: Set<string>;
  urls: Set<string>;
  reports: Set<string>;
  nws: boolean;
  news: boolean;
}

function prepareEvent(event: IncomingEvent): PreparedEvent {
  return {
    event, digest: isNewsDigest(event.title, event.description), time: toMs(event.occurred_at),
    words: tokens(event.title),
    urls: new Set(event.evidence.flatMap(item => item.url ? [item.url] : [])),
    reports: new Set(event.evidence.flatMap(item => item.upstream_id ? [JSON.stringify([item.source_id, item.upstream_id])] : [])),
    nws: event.evidence.some(item => item.source_id === 'noaa-nws'),
    news: isNewsEvent(event),
  };
}

/** Adapter IDs remain stable across observations; do not change durable identity keys. */
function distinctHazardIdentities(a: IncomingEvent, b: IncomingEvent): boolean {
  for (const [source, prefix] of [['usgs-earthquakes', 'usgs:'], ['gdacs', 'gdacs:']]) {
    if (a.id.startsWith(prefix) && b.id.startsWith(prefix)
      && a.evidence.some(e => e.source_id === source)
      && b.evidence.some(e => e.source_id === source)
      && a.id !== b.id) return true;
  }
  return false;
}

export function shouldFuseEvents(a: IncomingEvent, b: IncomingEvent): boolean {
  return shouldFusePrepared(prepareEvent(a), prepareEvent(b));
}

function exactPreparedMatch(left: PreparedEvent, right: PreparedEvent): boolean {
  if (left.event.id === right.event.id) return true;
  if (left.reports.size || right.reports.size) return [...left.reports].some(key => right.reports.has(key));
  return [...left.urls].some(url => right.urls.has(url));
}

function shouldFusePrepared(left: PreparedEvent, right: PreparedEvent): boolean {
  const a = left.event;
  const b = right.event;
  if (left.digest !== right.digest) return false;
  if (Boolean(a.withdrawn) !== Boolean(b.withdrawn)) return false;
  if (a.id === b.id) return true;
  if (distinctHazardIdentities(a, b)) return false;
  if (left.reports.size || right.reports.size) {
    return [...left.reports].some(report => right.reports.has(report));
  }
  if ([...left.urls].some(url => right.urls.has(url))) return true;
  if (left.nws && right.nws) return false;
  const timeDelta = Math.abs(left.time - right.time);
  if (!Number.isFinite(timeDelta) || timeDelta > 8 * 60 * 60_000) return false;
  const similarity = tokenSimilarity(left.words, right.words);
  const distance = haversineKm(a, b);
  const sameCategory = a.category === b.category;
  const sameFamily = categoryFamily(a.category) === categoryFamily(b.category);

  // News locations often denote a city/region centroid, not a precise incident.
  // Require strong title overlap; geography/time alone cannot identify a report.
  if (left.news || right.news) return similarity >= 0.68 && (distance === undefined || distance <= 250);

  // Earthquake sequences can contain many real aftershocks in the same area.
  // Without a shared identity, require both time and distance; titles alone
  // cannot distinguish separate earthquakes or establish their location.
  if (sameCategory && a.category === 'earthquake') {
    return timeDelta <= 15 * 60_000 && distance !== undefined && distance <= 25;
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
      const key = `${evidence.source_id}|${evidence.upstream_id || evidence.url || evidence.source}`;
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

export interface FusionProfile {
  prepare_ms: number;
  match_ms: number;
  finalize_ms: number;
  valid_signals: number;
  clusters: number;
  candidate_clusters: number;
  comparisons: number;
}

const MATCH_WINDOW = 8 * 60 * 60_000;

/** Conservative candidate index; the existing predicate and first-cluster order remain authoritative. */
class FusionCandidates {
  private ids = new Map<string, Set<number>>();
  private reports = new Map<string, Set<number>>();
  private urls = new Map<string, Set<number>>();
  private nwsTimes = new Map<number, Set<number>>();
  private otherTimes = new Map<number, Set<number>>();

  private add<K>(index: Map<K, Set<number>>, key: K, cluster: number) {
    let values = index.get(key);
    if (!values) { values = new Set(); index.set(key, values); }
    values.add(cluster);
  }

  record(row: PreparedEvent, cluster: number) {
    this.add(this.ids, row.event.id, cluster);
    for (const report of row.reports) this.add(this.reports, report, cluster);
    // Explicit report identity blocks both URL and fuzzy matching, even on only one side.
    if (row.reports.size) return;
    for (const url of row.urls) this.add(this.urls, url, cluster);
    this.add(row.nws ? this.nwsTimes : this.otherTimes, Math.floor(row.time / MATCH_WINDOW), cluster);
  }

  find(row: PreparedEvent): number[] {
    const candidates = new Set<number>();
    const include = (values?: Set<number>) => { if (values) for (const value of values) candidates.add(value); };
    include(this.ids.get(row.event.id));
    for (const report of row.reports) include(this.reports.get(report));
    if (!row.reports.size) {
      for (const url of row.urls) include(this.urls.get(url));
      const bucket = Math.floor(row.time / MATCH_WINDOW);
      for (let offset = -1; offset <= 1; offset++) {
        include(this.otherTimes.get(bucket + offset));
        if (!row.nws) include(this.nwsTimes.get(bucket + offset));
      }
    }
    // Greedy clustering must select the earliest matching cluster, not index traversal order.
    return [...candidates].sort((a, b) => a - b);
  }
}

export function fuseEvents(events: IncomingEvent[], options: { now?: number; limit?: number; onProfile?: (profile: FusionProfile) => void } = {}): FusedEvent[] {
  const now = options.now ?? Date.now();
  const started = performance.now();
  const valid = events
    .filter(event => event.title.trim().length >= 4 && toMs(event.occurred_at) > 0)
    .map(prepareEvent)
    .sort((a, b) => b.time - a.time);
  const prepared = performance.now();
  const clusters: PreparedEvent[][] = [];
  const index = new FusionCandidates();
  let candidateClusters = 0;
  let comparisons = 0;
  for (const row of valid) {
    const candidates = index.find(row);
    candidateClusters += candidates.length;
    let selected: number | undefined;
    for (const position of candidates) {
      const rows = clusters[position];
      if (rows.some(existing => distinctHazardIdentities(existing.event, row.event))) continue;
      // A news bridge must not connect otherwise incompatible reports.
      const compare = (existing: PreparedEvent) => { comparisons++; return shouldFusePrepared(existing, row); };
      const exact = rows.some(existing => exactPreparedMatch(existing, row) && compare(existing));
      if (!exact && rows.some(existing => (existing.news || row.news) && !compare(existing))) continue;
      if (rows.some(compare)) {
        selected = position; break;
      }
    }
    if (selected === undefined) { selected = clusters.length; clusters.push([row]); }
    else clusters[selected].push(row);
    index.record(row, selected);
  }
  const matched = performance.now();
  const result = clusters
    .map(cluster => fuseCluster(cluster.map(row => row.event), now))
    .sort((a, b) => b.priority_score - a.priority_score || toMs(b.last_seen_at) - toMs(a.last_seen_at))
    .slice(0, options.limit ?? 300);
  options.onProfile?.({ prepare_ms: Math.round(prepared - started), match_ms: Math.round(matched - prepared),
    finalize_ms: Math.round(performance.now() - matched), valid_signals: valid.length, clusters: clusters.length,
    candidate_clusters: candidateClusters, comparisons });
  return result;
}
