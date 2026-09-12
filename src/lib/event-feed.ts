import { fuseEvents, type EventCategory, type FusedEvent } from './event-fusion';
import { collectEventSources, type EventSourceHealth } from './event-sources';
import { collectSupplementalEventSignals } from './event-signals';

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
  const [core, supplemental] = await Promise.all([
    collectEventSources(),
    collectSupplementalEventSignals(),
  ]);

  const healthySources = core.healthy_sources + supplemental.healthy_sources;
  if (healthySources === 0) {
    // Trigger getUnifiedEventFeed's stale fallback instead of replacing a good
    // previous snapshot with a globally empty feed during a broad outage.
    throw new Error('all unified event sources unavailable');
  }

  const events = fuseEvents([...core.events, ...supplemental.events], { now, limit: 300 });
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
    source_health: [...core.health, ...supplemental.health],
    source_count: core.source_count + supplemental.source_count,
    healthy_sources: healthySources,
    generated_at: new Date(now).toISOString(),
  };
}

export async function getUnifiedEventFeed(options: { now?: number; force?: boolean } = {}): Promise<UnifiedEventFeed> {
  const state = cache();
  const now = options.now ?? Date.now();
  if (!options.force && state.value && now < state.expires_at) return structuredClone(state.value);
  if (state.inflight) return structuredClone(await state.inflight);

  const inflight = buildUnifiedEventFeed(now)
    .then(value => {
      state.value = value;
      state.expires_at = Date.now() + CACHE_TTL_MS;
      return value;
    })
    .finally(() => {
      state.inflight = undefined;
    });
  state.inflight = inflight;

  try {
    return structuredClone(await inflight);
  } catch (error) {
    if (state.value) {
      // Retry relatively soon while continuing to serve the last complete view.
      state.expires_at = Date.now() + 15_000;
      return structuredClone(state.value);
    }
    throw error;
  }
}

export function resetUnifiedEventFeedForTests() {
  globalThis.__OSIRIS_EVENT_FEED_CACHE__ = undefined;
}
