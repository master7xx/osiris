import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { IncomingEvent } from './event-fusion';
import { persistCollectorSignals, signalBatchRows } from './collector-signal-store';
const signal = (id: string, title = id) => ({ id, title, evidence: [{ source_id: 'b' }, { source_id: 'a' }] }) as IncomingEvent;
it('keeps exact keys and the final duplicate payload without mutating evidence order', () => {
  const original = signal('1');
  const latest = signal('1', 'updated');
  expect(signalBatchRows([original, latest, signal('2')])).toEqual([
    { id: JSON.stringify([['a', 'b'], '1']), payload: latest },
    { id: JSON.stringify([['a', 'b'], '2']), payload: signal('2') },
  ]);
  expect(original.evidence.map(e => e.source_id)).toEqual(['b', 'a']);
});
it('uses 30 bounded upserts for 3000 signals and releases the client', async () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  await persistCollectorSignals(pool, { owner: 'owner', generation: '1' }, Array.from({ length: 3000 }, (_, n) => signal(String(n))));
  const calls = query.mock.calls as unknown as [string, string[]?][];
  const inserts = calls.filter(([sql]) => sql.startsWith('INSERT'));
  expect(inserts).toHaveLength(30);
  expect(inserts.every(([, args]) => JSON.parse(args![0]).length === 100)).toBe(true);
  expect(calls.at(-1)?.[0]).toBe('COMMIT');
  expect(release).toHaveBeenCalledOnce();
});
