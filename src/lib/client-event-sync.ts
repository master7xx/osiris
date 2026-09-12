import { deduplicateReports, reportIdentity } from './event-identity';
import type { UnifiedEventFeed } from './event-feed';
import type { ContinuousEvent } from './event-ledger';
import type { FusedEvent } from './event-fusion';
import type { EventSourceHealth } from './event-sources';
import { isMappable } from './world-events-view';

export interface EventClientCache {
  version: 1;
  mode: 'snapshot' | 'durable';
  feed: UnifiedEventFeed;
  cursor?: string;
  savedAt: number;
  retainedIds?: string[];
}
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
interface Collector { last_success_at: string | null; source_health: EventSourceHealth[]; last_error?: string | null }
interface StoredEvent { id: string; revision: string; cursor: string; payload: FusedEvent; first_observed_at: string; last_observed_at: string; changed_at: string }
interface Change { event_id: string; revision: string; cursor: string; payload: FusedEvent; committed_at: string }

function checkEvent(event: FusedEvent) {
  if (event?.supersedes !== undefined && (!Array.isArray(event.supersedes) || !event.supersedes.every(url => typeof url === 'string'))) throw new Error('Invalid event lifecycle');
  if (event?.withdrawn !== undefined && typeof event.withdrawn !== 'boolean') throw new Error('Invalid event lifecycle');
  if (!event || typeof event.id !== 'string' || typeof event.title !== 'string' || !Array.isArray(event.evidence)
    || !Array.isArray(event.sources) || !event.sources.every(source => typeof source === 'string')
    || typeof event.description !== 'string' || !event.evidence.every(item => item && typeof item.source === 'string' && typeof item.source_id === 'string'
      && (item.upstream_id === undefined || typeof item.upstream_id === 'string' && item.upstream_id.length > 0))
    || !Number.isFinite(event.priority_score) || !Number.isFinite(event.severity) || !Number.isFinite(Date.parse(event.occurred_at))) throw new Error('Invalid event data');
}
function checkHealth(value: unknown): asserts value is EventSourceHealth[] {
  if (!Array.isArray(value) || value.some(source => !source || typeof source.id !== 'string'
    || !['healthy', 'partial', 'error'].includes(source.state) || !Number.isFinite(source.source_count)
    || !Number.isFinite(source.healthy_sources))) throw new Error('Invalid source health');
}
function numeric(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid event sequence');
  return parsed;
}
function record(row: StoredEvent): ContinuousEvent {
  checkEvent(row.payload);
  if (typeof row.id !== 'string') throw new Error('Invalid event identity');
  return { ...row.payload, id: row.id, fused_id: row.id, lifecycle: 'ongoing',
    first_observed_at: row.first_observed_at, last_observed_at: row.last_observed_at, changed_at: row.changed_at,
    update_count: Math.max(0, numeric(row.revision) - 1), change_sequence: numeric(row.cursor) };
}
function project(events: ContinuousEvent[], collector: Collector | null, fallback?: UnifiedEventFeed): UnifiedEventFeed {
  const generated = collector?.last_success_at ?? fallback?.generated_at;
  if (!generated || !Number.isFinite(Date.parse(generated))) throw new Error('Collector has not produced a snapshot');
  const health = collector?.source_health ?? fallback?.source_health ?? [];
  checkHealth(health);
  const categories: UnifiedEventFeed['categories'] = {};
  for (const event of events) categories[event.category] = (categories[event.category] ?? 0) + 1;
  return { ...(!collector && fallback?.refresh_error ? {
    refresh_error: fallback.refresh_error, refresh_attempted_at: fallback.refresh_attempted_at,
  } : {}), events, total: events.length, mappable: events.filter(isMappable).length,
    confirmed: events.filter(event => event.confidence === 'confirmed').length, corroborating: events.filter(event => event.confidence === 'corroborating').length,
    unconfirmed: events.filter(event => event.confidence === 'unconfirmed').length, categories, source_health: health,
    source_count: health.reduce((n, source) => n + source.source_count, 0), healthy_sources: health.reduce((n, source) => n + source.healthy_sources, 0),
    cursor: events.reduce((n, event) => Math.max(n, event.change_sequence), 0), new_events: 0, updated_events: 0, ongoing_events: events.length,
    generated_at: generated };
}
async function json(response: Response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
export function validateClientCache(value: unknown): EventClientCache | null {
  try {
    const cache = value as EventClientCache;
    if (cache.version !== 1 || !['snapshot', 'durable'].includes(cache.mode) || !Number.isFinite(cache.savedAt)
      || !Array.isArray(cache.feed.events) || !Array.isArray(cache.feed.source_health) || !Number.isFinite(Date.parse(cache.feed.generated_at))
      || cache.mode === 'durable' && (typeof cache.cursor !== 'string' || !cache.cursor.length)) return null;
    if (cache.feed.refresh_error !== undefined && typeof cache.feed.refresh_error !== 'string') return null;
    if (cache.feed.refresh_attempted_at !== undefined && !Number.isFinite(Date.parse(cache.feed.refresh_attempted_at))) return null;
    checkHealth(cache.feed.source_health);
    if (cache.retainedIds !== undefined && (!Array.isArray(cache.retainedIds) || !cache.retainedIds.every(id => typeof id === 'string'))) return null;
    cache.feed.events.forEach(checkEvent); return cache;
  } catch { return null; }
}

/** Keep previously displayed reports for 48 hours without renewing their clocks. */
export function mergeSnapshotCache(previous: EventClientCache | null, next: EventClientCache): EventClientCache {
  const now = next.savedAt;
  const current = new Map(deduplicateReports(next.feed.events).map(event => [event.id, event]));
  const freshReports = new Set([...current.values()].map(reportIdentity));
  const retainedIds: string[] = [];
  if (previous?.mode === 'snapshot') {
    for (const event of previous.feed.events) {
      const age = now - Date.parse(event.last_observed_at);
      if (!current.has(event.id) && !freshReports.has(reportIdentity(event)) && Number.isFinite(age) && age <= 48 * 3600000) {
        current.set(event.id, event);
        retainedIds.push(event.id);
      }
    }
  }
  const events = deduplicateReports([...current.values()]);
  const kept = new Set(events.map(event => event.id));
  return { ...next, retainedIds: retainedIds.filter(id => kept.has(id)), feed: project(events, null, next.feed) };
}

/** Returns a new data+cursor checkpoint only after the whole bounded synchronization succeeds. */
export async function synchronizeEvents(previous: EventClientCache | null, fetcher: Fetcher, signal: AbortSignal): Promise<EventClientCache> {
  const get = (url: string) => fetcher(url, { cache: 'no-store', signal });
  const config = await json(await get('/api/events/sync'));
  if (config.version !== 1 || !['snapshot', 'durable'].includes(config.mode)) throw new Error('Unsupported event sync mode');
  if (config.mode === 'snapshot') {
    const feed: UnifiedEventFeed = await json(await get('/api/events/snapshot'));
    const cache = validateClientCache({ version: 1, mode: 'snapshot', feed, savedAt: Date.now() });
    if (!cache) throw new Error('Invalid event snapshot');
    return mergeSnapshotCache(previous, cache);
  }
  const bootstrap = async (): Promise<EventClientCache> => {
    const data = await json(await get('/api/events/stored'));
    if (!Array.isArray(data.events) || typeof data.cursor !== 'string' || !data.cursor) throw new Error('Invalid bootstrap');
    return { version: 1, mode: 'durable', feed: project(data.events.map(record), data.collector), cursor: data.cursor, savedAt: Date.now() };
  };
  if (previous?.mode !== 'durable' || !previous.cursor) return bootstrap();
  const events = new Map(previous.feed.events.map(event => [event.id, event]));
  let cursor = previous.cursor;
  let collector: Collector | null = null;
  for (let page = 0; page < 20; page++) {
    const response = await get(`/api/events/changes?cursor=${encodeURIComponent(cursor)}&limit=300`);
    if (response.status === 410) return bootstrap();
    const data = await json(response);
    if (!Array.isArray(data.changes) || typeof data.cursor !== 'string' || !data.cursor || typeof data.has_more !== 'boolean') throw new Error('Invalid event changes');
    for (const change of data.changes as Change[]) {
      const existing = events.get(change.event_id);
      const next = record({ id: change.event_id, revision: change.revision, cursor: change.cursor, payload: change.payload,
        first_observed_at: existing?.first_observed_at ?? change.committed_at, last_observed_at: change.committed_at, changed_at: change.committed_at });
      if (!existing || next.change_sequence > existing.change_sequence) events.set(next.id, next);
    }
    for (const observation of data.observations ?? []) {
      const existing = events.get(observation.id);
      if (existing && Number.isFinite(Date.parse(observation.last_observed_at)) && Number.isFinite(observation.priority_score)) {
        events.set(existing.id, { ...existing, last_observed_at: observation.last_observed_at, priority_score: observation.priority_score });
      }
    }
    if (data.has_more && data.cursor === cursor) throw new Error('Event cursor did not advance');
    cursor = data.cursor; collector = data.collector ?? collector;
    if (!data.has_more) return { version: 1, mode: 'durable', feed: project([...events.values()], collector, previous.feed), cursor, savedAt: Date.now() };
  }
  // Large backlog: use a new coherent snapshot instead of retrying the same prefix forever.
  return bootstrap();
}
