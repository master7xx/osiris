import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUnifiedEventFeed, resetUnifiedEventFeedForTests } from './event-feed';
import { mergeSnapshotCache, validateClientCache, type EventClientCache } from './client-event-sync';
import { DEFAULT_EVENT_FILTERS, projectWorldEvents } from './world-events-view';
import type { IncomingEvent } from './event-fusion';
import { collectEventSources } from './event-sources';

vi.mock('./event-sources', () => ({ collectEventSources: vi.fn() }));
vi.mock('./event-signals', () => ({
  collectSupplementalEventSignals: vi.fn(async () => ({ events: [], health: [], source_count: 0, healthy_sources: 0 })),
}));
const healthy = { events: [], health: [], source_count: 1, healthy_sources: 1 };

beforeEach(() => {
  resetUnifiedEventFeedForTests();
  vi.mocked(collectEventSources).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('shared event feed refresh', () => {
  it('serves the last good snapshot to every concurrent caller during an outage', async () => {
    vi.useFakeTimers();
    vi.mocked(collectEventSources).mockResolvedValueOnce(healthy);
    const good = await getUnifiedEventFeed();
    vi.advanceTimersByTime(46_000);
    vi.mocked(collectEventSources).mockResolvedValue({ ...healthy, healthy_sources: 0 });

    const [first, second] = await Promise.all([getUnifiedEventFeed(), getUnifiedEventFeed()]);
    expect(first.events).toEqual(good.events);
    expect(first.generated_at).toBe(good.generated_at);
    expect(first.healthy_sources).toBe(0);
    expect(first.refresh_error).toContain('unavailable');
    expect(first.refresh_attempted_at).not.toBe(good.generated_at);
    expect(second).toEqual(first);
    expect(first).not.toBe(second);
    expect(collectEventSources).toHaveBeenCalledTimes(2);
    await getUnifiedEventFeed();
    expect(collectEventSources).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(16_000);
    vi.mocked(collectEventSources).mockResolvedValue(healthy);
    const recovered = await getUnifiedEventFeed();
    expect(recovered.generated_at).not.toBe(good.generated_at);
    expect(recovered.refresh_error).toBeUndefined();
    expect(recovered.healthy_sources).toBe(1);
    expect(collectEventSources).toHaveBeenCalledTimes(3);
  });

  it('rejects every concurrent caller when no prior snapshot exists', async () => {
    vi.mocked(collectEventSources).mockResolvedValue({ ...healthy, healthy_sources: 0 });
    const results = await Promise.allSettled([getUnifiedEventFeed(), getUnifiedEventFeed()]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(collectEventSources).toHaveBeenCalledTimes(1);
  });
});


it('preserves data and observation clocks through partial/full outage, reload and recovery', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T10:00:00Z'));
  const make = (id: string, category: IncomingEvent['category']): IncomingEvent => ({
    id, title: category === 'weather' ? 'Tornado warning for Oklahoma' : 'Critical software vulnerability exploited', category, occurred_at: '2026-09-12T10:00:00Z', severity: 50,
    evidence: [{ source_id: id, source: id, kind: 'official', independent: true, weight: 1, url: `https://example.test/${id}` }],
  });
  const a = make('a', 'weather'); const b = make('b', 'cyber');
  const health = (id: string, ok: boolean) => ({ id, label: id, state: ok ? 'healthy' as const : 'error' as const,
    ok, duration_ms: 1, events: ok ? 1 : 0, source_count: 1, healthy_sources: ok ? 1 : 0 });
  let checkpoint: EventClientCache | null = null;
  const load = async (events: IncomingEvent[], okA: boolean, okB: boolean) => {
    vi.mocked(collectEventSources).mockResolvedValue({ events, health: [health('a', okA), health('b', okB)], source_count: 2, healthy_sources: Number(okA) + Number(okB) });
    const feed = await getUnifiedEventFeed({ force: true });
    checkpoint = mergeSnapshotCache(checkpoint, { version: 1, mode: 'snapshot', feed, savedAt: Date.now() });
    checkpoint = validateClientCache(JSON.parse(JSON.stringify(checkpoint)));
    expect(checkpoint).not.toBeNull();
    return checkpoint!;
  };
  const initial = await load([a, b], true, true);
  const firstB = initial.feed.events.find(event => event.category === 'cyber')!;
  const ids = initial.feed.events.map(event => event.id).sort();
  for (let cycle = 0; cycle < 20; cycle++) {
    vi.advanceTimersByTime(1000);
    const partial = await load([a], true, false);
    expect(partial.feed.healthy_sources).toBe(1);
    const cyber = projectWorldEvents(partial.feed.events, { ...DEFAULT_EVENT_FILTERS, category: 'cyber' }, Date.now());
    expect(cyber.events).toHaveLength(1);
    expect(cyber.sources.map(source => source.source_id)).toEqual(['b']);
    expect(cyber.events[0].last_observed_at).toBe(firstB.last_observed_at);
    expect(projectWorldEvents(partial.feed.events, { ...DEFAULT_EVENT_FILTERS, category: 'weather' }, Date.now()).sources.map(source => source.source_id)).toEqual(['a']);
    vi.advanceTimersByTime(1000);
    const failed = await load([], false, false);
    expect(failed.feed.events.map(event => event.id).sort()).toEqual(ids);
    expect(failed.feed.generated_at).toBe(partial.feed.generated_at);
    expect(failed.feed.refresh_error).toContain('unavailable');
    expect(failed.feed.healthy_sources).toBe(0);
    expect(failed.feed.source_health.every(source => source.state === 'error')).toBe(true);
  }
  vi.advanceTimersByTime(1000);
  const restored = await load([a, b], true, true);
  expect(restored.feed.events.map(event => event.id).sort()).toEqual(ids);
  expect(restored.retainedIds).toEqual([]);
  expect(restored.feed.refresh_error).toBeUndefined();
  expect(restored.feed.healthy_sources).toBe(2);
});


it('marks current health unavailable after an unexpected collector exception', async () => {
  const source = { id: 'a', label: 'A', state: 'healthy' as const, ok: true, duration_ms: 1, events: 0, source_count: 1, healthy_sources: 1 };
  vi.mocked(collectEventSources).mockResolvedValue({ ...healthy, health: [source] });
  const good = await getUnifiedEventFeed();
  vi.mocked(collectEventSources).mockRejectedValue(new Error('collector crashed'));
  const failed = await getUnifiedEventFeed({ force: true });
  expect(failed.generated_at).toBe(good.generated_at);
  expect(failed.refresh_error).toBe('collector crashed');
  expect(failed.source_health[0]).toMatchObject({ state: 'error', ok: false, healthy_sources: 0 });
});
