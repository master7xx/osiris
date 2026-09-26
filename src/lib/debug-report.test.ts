import { describe, expect, it } from 'vitest';
import { buildDebugReport } from './debug-report';
import type { ClientEventIngestSnapshot } from './event-health-client';
const now = Date.parse('2026-09-26T12:00:00Z');
const health: ClientEventIngestSnapshot = {
  mode: 'durable', checkpoint_saved_at: new Date(now).toISOString(), generated_at: new Date(now - 60000).toISOString(),
  total: 4, mappable: 2, confirmed: 1, corroborating: 1, unconfirmed: 2, categories: { weather: 4 },
  source_count: 2, healthy_sources: 1, source_health: [{ id: 'test', label: 'Test source', state: 'partial', ok: true, duration_ms: 15, events: 4, source_count: 2, healthy_sources: 1 }],
};
describe('debug report event health', () => {
  it('distinguishes successful client sync from stale collector data at export time', () => {
    const report = buildDebugReport([], health, 'test', now + 240000);
    expect(report.eventIngest?.checkpointSavedAt).toBe(health.checkpoint_saved_at);
    expect(report.eventIngest?.freshness).toMatchObject({ stale: true, ageSeconds: 300, staleAfterSeconds: 180 });
    expect(report.eventIngest?.counts.healthySources).toBe(1);
  });
  it('preserves unknown health and marks cached data stale even when recently generated', () => {
    expect(buildDebugReport([], null, 'test', now).eventIngest).toBeNull();
    expect(buildDebugReport([], { ...health, cached: true, refresh_error: 'HTTP 503' }, 'test', now).eventIngest).toMatchObject({ cached: true, refreshError: 'HTTP 503', freshness: { stale: true } });
    expect(buildDebugReport([], health, 'test', now).eventIngest?.freshness.stale).toBe(false);
  });
  it('exports only health metadata without event payloads or opaque cursors', () => {
    const input = { ...health, events: [{ title: 'private-payload' }], cursor: 'private-cursor' };
    const report = buildDebugReport([], input, 'test', now);
    expect(JSON.stringify(report)).not.toContain('private-');
    report.eventIngest!.sources[0].state = 'error';
    report.eventIngest!.categories.weather = 99;
    expect(health.source_health[0].state).toBe('partial');
    expect(health.categories.weather).toBe(4);
  });
});
