import { eventDatabase } from './event-database';
import { DurableEventReader } from './durable-event-reader';
import type { UnifiedEventFeed } from './event-feed';
import type { FusedEvent } from './event-fusion';
import type { EventSourceHealth } from './event-sources';
function sequence(value: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Legacy numeric cursor exhausted; use durable replay');
  return number;
}
export async function readDurableUnifiedFeed(): Promise<UnifiedEventFeed> {
  const pool = eventDatabase();
  if (!pool) throw new Error('EVENT_DATABASE_URL is required in durable mode');
  const snapshot = await new DurableEventReader(pool).bootstrap();
  if (!snapshot.collector?.last_success_at) throw new Error('Collector has not produced a snapshot');
  const all = snapshot.events.map(row => {
    const event = row.payload as FusedEvent;
    return { ...event, id: row.id, fused_id: row.id, lifecycle: 'ongoing' as const,
      first_observed_at: new Date(row.first_observed_at).toISOString(), last_observed_at: new Date(row.last_observed_at).toISOString(),
      changed_at: new Date(row.changed_at).toISOString(), update_count: sequence(row.revision) - 1, change_sequence: sequence(row.cursor),
      age_minutes: Math.max(0, Math.floor((Date.now() - Date.parse(event.occurred_at)) / 60000)) };
  });
  const events = all.filter(event => Date.now() - Date.parse(event.last_observed_at) <= 48 * 60 * 60 * 1000).sort((a, b) => b.priority_score - a.priority_score).slice(0, 300);
  const health = snapshot.collector.source_health as EventSourceHealth[];
  const categories: UnifiedEventFeed['categories'] = {};
  for (const event of events) categories[event.category] = (categories[event.category] ?? 0) + 1;
  return { events, total: events.length, mappable: events.filter(event => typeof event.lat === 'number' && typeof event.lng === 'number' && event.location_confidence >= .75).length,
    confirmed: events.filter(event => event.confidence === 'confirmed').length, corroborating: events.filter(event => event.confidence === 'corroborating').length,
    unconfirmed: events.filter(event => event.confidence === 'unconfirmed').length, categories, source_health: health,
    source_count: health.reduce((sum, source) => sum + source.source_count, 0), healthy_sources: health.reduce((sum, source) => sum + source.healthy_sources, 0),
    cursor: all.reduce((cursor, event) => Math.max(cursor, event.change_sequence), 0), new_events: 0, updated_events: 0, ongoing_events: events.length,
    generated_at: new Date(snapshot.collector.last_success_at).toISOString() };
}
