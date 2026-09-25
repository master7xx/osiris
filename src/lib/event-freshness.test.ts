import { expect, it } from 'vitest';
import { eventFreshness } from './event-freshness';
const stamp = '2026-09-25T16:00:00.000Z';
const start = Date.parse(stamp);
it('ages without a new response and preserves the existing three-minute boundary', () => {
  expect(eventFreshness(stamp, start + 180000).stale).toBe(false);
  expect(eventFreshness(stamp, start + 180001).stale).toBe(true);
  expect(eventFreshness(stamp, start + 86400000)).toEqual({ stale: true, ageSeconds: 86400, timestamp: '2026-09-25 16:00:00 UTC' });
});
it('marks cached results as historical and recovers on a fresh result', () => {
  expect(eventFreshness(stamp, start, true).stale).toBe(true);
  expect(eventFreshness(stamp, start).stale).toBe(false);
});
it('does not present unknown dates as fresh or produce negative ages for clock skew', () => {
  expect(eventFreshness(undefined, start).stale).toBe(true);
  expect(eventFreshness('broken', start).timestamp).toBe('Unknown');
  expect(eventFreshness(stamp, 0).stale).toBe(true);
  expect(eventFreshness(stamp, start - 1000).ageSeconds).toBe(0);
});
