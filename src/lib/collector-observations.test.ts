import { describe, expect, it } from 'vitest';
import { batches, observationIndex } from './collector-observations';
import type { FusedEvent, IncomingEvent } from './event-fusion';
describe('durable collector observation integrity', () => {
  it('batches more than 300 candidates without dropping any', () => {
    const events = Array.from({ length: 701 }, (_, id) => id);
    expect(batches(events).map(batch => batch.length)).toEqual([300, 300, 101]);
    expect(batches(events).flat()).toEqual(events);
  });
  it('keeps the time of the source observation when retained signals are reprocessed', () => {
    const evidence = [{ source_id: 'source', source: 'Source', kind: 'sensor' as const, independent: true, weight: 1, url: 'https://example.org/event/1' }];
    const index = observationIndex([{ payload: { evidence } as IncomingEvent, observed_at: '2026-09-10T00:00:00Z' }]);
    expect(index({ evidence } as FusedEvent)).toBe('2026-09-10T00:00:00.000Z');
  });
});
