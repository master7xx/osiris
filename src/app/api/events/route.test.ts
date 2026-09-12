import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { getUnifiedEventFeed, type UnifiedEventFeed } from '@/lib/event-feed';
import type { ContinuousEvent } from '@/lib/event-ledger';

vi.mock('@/lib/event-feed', () => ({ getUnifiedEventFeed: vi.fn() }));

// Only fields read by the route are needed for these pagination fixtures.
const events = [5, 2, 4, 1, 3].map(sequence => ({
  id: `event-${sequence}`, change_sequence: sequence, category: 'conflict',
  lifecycle: 'new', severity: 70, location_confidence: 0,
})) as ContinuousEvent[];

beforeEach(() => {
  vi.mocked(getUnifiedEventFeed).mockResolvedValue({ events, cursor: 5, total: 5 } as UnifiedEventFeed);
});

async function page(query: string) {
  return (await GET(new Request(`http://localhost/api/events?${query}`))).json();
}

describe('event delta pagination', () => {
  it('delivers every available change across limited pages, starting at zero', async () => {
    let cursor = 0;
    const received: string[] = [];
    for (let i = 0; i < 3; i++) {
      const body = await page(`since=${cursor}&limit=2`);
      expect(body.delta).toBe(true);
      expect(body.feed_cursor).toBe(5);
      expect(body.cursor).toBeGreaterThan(cursor);
      received.push(...body.events.map((event: ContinuousEvent) => event.id));
      cursor = body.cursor;
      expect(body.has_more).toBe(i < 2);
    }
    expect(received).toEqual(['event-1', 'event-2', 'event-3', 'event-4', 'event-5']);
    const empty = await page(`since=${cursor}&limit=2`);
    expect(empty.events).toEqual([]);
    expect(empty.cursor).toBe(5);
    expect(empty.has_more).toBe(false);
  });

  it('preserves priority order for ordinary snapshot consumers', async () => {
    const body = await page('limit=2');
    expect(body.events.map((event: ContinuousEvent) => event.id)).toEqual(['event-5', 'event-2']);
    expect(body.delta).toBe(false);
    expect(body.cursor).toBe(5);
  });

  it('advances past nonmatching changes after exhausting a filtered delta', async () => {
    const body = await page('since=2&category=earthquake');
    expect(body.events).toEqual([]);
    expect(body.has_more).toBe(false);
    expect(body.cursor).toBe(5);
  });
});
