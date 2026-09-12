import type { EventCategory } from './event-fusion';
import type { ContinuousEvent } from './event-ledger';

export const WORLD_EVENT_CATEGORIES = ['conflict', 'protest', 'political', 'earthquake', 'flood', 'wildfire', 'volcano', 'weather', 'cyber', 'infrastructure', 'aviation', 'maritime', 'other'] as const satisfies readonly EventCategory[];

export interface EventFilters { category: string; severity: number; confidence: string; mappable: boolean }
export const DEFAULT_EVENT_FILTERS: EventFilters = { category: '', severity: 0, confidence: '', mappable: false };
export function isMappable(event: ContinuousEvent) {
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
