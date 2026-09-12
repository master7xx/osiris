import { isNewsDigest } from './event-text';
import type { EventCategory } from './event-fusion';
import type { ContinuousEvent } from './event-ledger';

export const WORLD_EVENT_CATEGORIES = ['conflict', 'protest', 'political', 'earthquake', 'flood', 'wildfire', 'volcano', 'weather', 'cyber', 'infrastructure', 'aviation', 'maritime', 'other'] as const satisfies readonly EventCategory[];

export interface EventFilters { category: string; severity: number; confidence: string; mappable: boolean }
export const DEFAULT_EVENT_FILTERS: EventFilters = { category: '', severity: 0, confidence: '', mappable: false };
export function isMappable(event: ContinuousEvent) {
  if (event.tags?.includes('digest') || isNewsDigest(event.title, event.description)) return false;
  return typeof event.lat === 'number' && Number.isFinite(event.lat) && Math.abs(event.lat) <= 90
    && typeof event.lng === 'number' && Number.isFinite(event.lng) && Math.abs(event.lng) <= 180
    && event.location_confidence >= 0.75;
}
export function filterWorldEvents(events: ContinuousEvent[], filters: EventFilters) {
  return events.filter(event => (!filters.category || event.category === filters.category)
    && event.severity >= filters.severity && (!filters.confidence || event.confidence === filters.confidence)
    && (!filters.mappable || isMappable(event)));
}
export function safeEventUrl(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

/** One projection shared by the cards, markers and category summary. */
export function projectWorldEvents(events: ContinuousEvent[], filters: EventFilters, now: number) {
  const unique = new Map(events.map(event => [event.id, event]));
  const active = [...unique.values()].filter(event => now - Date.parse(event.last_observed_at) <= 48 * 3600000);
  const matching = filterWorldEvents(active, filters).sort((a, b) => b.priority_score - a.priority_score);
  const visible = matching.slice(0, 300);
  const sources = new Map(visible.flatMap(event => event.evidence.map(item => [item.source_id, item] as const)));
  return { events: visible, matching: matching.length, sources: [...sources.values()] };
}
