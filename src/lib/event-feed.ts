import { fuseEvents, type EventCategory, type FusedEvent } from './event-fusion';
import { collectEventSources, type EventSourceHealth } from './event-sources';

export interface UnifiedEventFeed {
  events: FusedEvent[];
  total: number;
  mappable: number;
  confirmed: number;
  corroborating: number;
  unconfirmed: number;
  categories: Partial<Record<EventCategory, number>>;
  source_health: EventSourceHealth[];
  source_count: number;
  healthy_sources: number;
  generated_at: string;
}

interface FeedCache {
  value?: UnifiedEventFeed;
  expires_at: number;
  inflight?: Promise<UnifiedEventFeed>;
}

declare global {
  // eslint-disable-next-line no-var
  var __OSIRIS_EVENT_FEED_CACHE__: FeedCache | undefined;
}

const CACHE_TTL_MS = 45_000;

function cache(): FeedCache {
  if (!globalThis.__OSIRIS_EVENT_FEED_CACHE__) {
    globalThis.__OSIRIS_EVENT_FEED_CACHE__ = { expires_at: 0 };
  }
  return globalThis.__OSIRIS_EVENT_FEED_CACHE__;
}

async function buildUnifiedEventFeed(now = Date.now()): Promise<UnifiedEventFeed> {
  const collected = await collectEventSources();
  const events = fuseEvents(collected.events, { now, limit: 300 });
  const categories: Partial<Record<EventCategory, number>> = {};
  for (const event of events) categories[event.category] = (categories[event.category] ?? 0) + 1;

  return {
    events,
    total: events.length,
    mappable: events.filter(event => typeof event.lat === 'number' && typeof event.lng === 'number' && event.location_confidence >= 0.75).length,
    confirmed: events.filter(event => event.confidence === 'confirmed').length,
    corroborating: events.filter(event => event.confidence === 'corroborating').length,
    unconfirmed: events.filter(event => event.confidence === 'unconfirmed').length,
    categories,
    source_health: collected.health,
    source_count: collected.source_count,
    healthy_sources: collected.healthy_sources,
    generated_at: new Date(now).toISOString(),
  };
}

export async function getUnifiedEventFeed(options: { now?: number; force?: boolean } = {}): Promise<UnifiedEventFeed> {
  const state = cache();
  const now = options.now ?? Date.now();
  if (!options.force && state.value && now < state.expires_at) return structuredClone(state.value);
  if (state.inflight) return structuredClone(await state.inflight);

  state.inflight = buildUnifiedEventFeed(now)
    .then(value => {
      state.value = value;
      state.expires_at = Date.now() + CACHE_TTL_MS;
      return value;
    })
    .finally(() => {
      state.inflight = undefined;
    });

  try {
    return structuredClone(await state.inflight);
  } catch (error) {
    if (state.value) return structuredClone(state.value);
    throw error;
  }
}

export function resetUnifiedEventFeedForTests() {
  globalThis.__OSIRIS_EVENT_FEED_CACHE__ = undefined;
}
