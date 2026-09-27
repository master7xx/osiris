import { expect, it } from 'vitest';
import { conflictSample } from './collector-conflict-samples';
import { collectorCycleLog } from './collector-cycle-log';
it('keeps bounded stable conflict references without raw candidate IDs, URLs or evidence', () => {
  const matches = Array.from({ length: 12 }, (_, i) => ({ id: `stored-${i}`, revision: '1', secret: 'private' }));
  const identities = Array.from({ length: 12 }, (_, i) => ({ sourceId: `source-${i}`, upstreamId: 'private-url' }));
  const sample = conflictSample('multiple_stored_events', 'private-candidate', matches, identities);
  expect(sample).toEqual(conflictSample('multiple_stored_events', 'private-candidate', matches, identities));
  expect(sample.stored_events).toHaveLength(10);
  expect(sample.sources).toHaveLength(10);
  expect(sample.stored_event_count).toBe(12);
  expect(sample.source_count).toBe(12);
  const lines: string[] = [];
  const log = collectorCycleLog('cycle', line => lines.push(line));
  log.conflicts({ multiple_stored_events: 12, repeated_stored_event: 0 }, Array(12).fill({ ...sample, secret: 'private' }));
  const parsed = JSON.parse(lines.at(-1)!.replace('[collector] ', ''));
  expect(parsed.samples).toHaveLength(10);
  expect(JSON.stringify(parsed)).not.toContain('private');
});
