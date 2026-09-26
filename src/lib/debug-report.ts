import { publicSourceFailure } from './source-failure';
import { getDebugEventsSnapshot, type DebugRequestEvent } from './debug-events';
import { getEventIngestHealthSnapshot, type ClientEventIngestSnapshot } from './event-health-client';
import { eventFreshness, EVENT_STALE_AFTER_MS } from './event-freshness';

export function buildDebugReport(events: DebugRequestEvent[], ingest: ClientEventIngestSnapshot | null, userAgent: string, now = Date.now()) {
  // Explicit fields: health snapshots may also carry the full feed at runtime.
  const eventIngest = ingest ? {
    mode: ingest.mode ?? null,
    checkpointSavedAt: ingest.checkpoint_saved_at ?? null,
    feedGeneratedAt: ingest.generated_at ?? null,
    cached: Boolean(ingest.cached),
    refreshError: ingest.refresh_error ?? null,
    freshness: { ...eventFreshness(ingest.generated_at, now, Boolean(ingest.cached)), staleAfterSeconds: EVENT_STALE_AFTER_MS / 1000 },
    counts: { total: ingest.total, mappable: ingest.mappable, confirmed: ingest.confirmed,
      corroborating: ingest.corroborating, unconfirmed: ingest.unconfirmed,
      sourceCount: ingest.source_count, healthySources: ingest.healthy_sources },
    categories: { ...ingest.categories },
    sources: ingest.source_health.map(source => ({ id: source.id, label: source.label, state: source.state,
      ok: source.ok, durationMs: source.duration_ms, events: source.events,
      sourceCount: source.source_count, healthySources: source.healthy_sources, failure: publicSourceFailure(source.failure) })),
  } : null;
  return { reportVersion: 2, exportedAt: new Date(now).toISOString(), userAgent, events, eventIngest };
}

export function captureDebugReport(userAgent: string) {
  return buildDebugReport(getDebugEventsSnapshot(), getEventIngestHealthSnapshot(), userAgent);
}
