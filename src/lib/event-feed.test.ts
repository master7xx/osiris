import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUnifiedEventFeed, resetUnifiedEventFeedForTests } from './event-feed';
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
    expect(first).toEqual(good);
    expect(second).toEqual(good);
    expect(first).not.toBe(second);
    expect(collectEventSources).toHaveBeenCalledTimes(2);
    await getUnifiedEventFeed();
    expect(collectEventSources).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(16_000);
    vi.mocked(collectEventSources).mockResolvedValue(healthy);
    const recovered = await getUnifiedEventFeed();
    expect(recovered.generated_at).not.toBe(good.generated_at);
    expect(collectEventSources).toHaveBeenCalledTimes(3);
  });

  it('rejects every concurrent caller when no prior snapshot exists', async () => {
    vi.mocked(collectEventSources).mockResolvedValue({ ...healthy, healthy_sources: 0 });
    const results = await Promise.allSettled([getUnifiedEventFeed(), getUnifiedEventFeed()]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(collectEventSources).toHaveBeenCalledTimes(1);
  });
});
