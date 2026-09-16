import { afterEach, expect, it, vi } from 'vitest';
import { createIdentitySnapshot, replayIdentitySnapshot } from './identity-reconciliation-snapshot';

function fixture() {
  return createIdentitySnapshot({ sampled_at: '2026-09-16T00:00:00Z', cursor: '5104',
    reconciliation: { epoch: 'epoch', groups: [], notes: [], executable: false },
    snapshotData: { signals: [], links: [], events: [], history: [], requested_event_ids: ['missing-parent'] },
  } as unknown as Parameters<typeof createIdentitySnapshot>[0]);
}
afterEach(() => vi.useRealTimers());
it('replays identically after the retention window and keeps missing parents unresolved', () => {
  const snapshot = fixture();
  const first = replayIdentitySnapshot(snapshot);
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01'));
  expect(replayIdentitySnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(first);
  expect(first.reconciliation.unresolved_event_ids).toEqual(['missing-parent']);
  expect(first).not.toHaveProperty('snapshotData');
});
it('rejects changed payloads, unsupported versions and broken files', () => {
  const changed = fixture(); changed.data.report.cursor = '999';
  expect(() => replayIdentitySnapshot(changed)).toThrow();
  const version = fixture(); version.data.algorithm = 'unknown';
  expect(() => replayIdentitySnapshot(version)).toThrow();
  expect(() => replayIdentitySnapshot(null)).toThrow();
  expect(() => replayIdentitySnapshot({})).toThrow();
});
