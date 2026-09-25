import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { lookupCollectorIdentities } from './collector-identity-lookup';

it('preserves candidate order, same-parent matches and multi-parent bridges without key collisions', async () => {
  const a = { sourceId: 'source', upstreamId: 'a' };
  const b = { sourceId: 'source', upstreamId: 'b' };
  const c = { sourceId: 'other', upstreamId: 'a' };
  const query = vi.fn().mockResolvedValue({ rows: [
    { source_id: 'other', upstream_id: 'a', id: 'second', revision: '3' },
    { source_id: 'source', upstream_id: 'b', id: 'first', revision: '2' },
    { source_id: 'source', upstream_id: 'a', id: 'first', revision: '2' },
  ] });
  const renew = vi.fn(async () => {});
  const groups = [[a, b, a], [c, a], [b], [{ sourceId: 'new', upstreamId: 'a' }]];
  const result = await lookupCollectorIdentities({ query } as unknown as Pool, groups, renew);
  expect(result).toEqual([
    [{ id: 'first', revision: '2' }],
    [{ id: 'second', revision: '3' }, { id: 'first', revision: '2' }],
    [{ id: 'first', revision: '2' }], [],
  ]);
  expect(query).toHaveBeenCalledTimes(1);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1][0]).toHaveLength(4);
});

it('bounds queries and renews ownership for a large candidate set', async () => {
  const groups = Array.from({ length: 601 }, (_, n) => [{ sourceId: 'source', upstreamId: String(n) }]);
  const query = vi.fn(async () => ({ rows: [] }));
  const renew = vi.fn(async () => {});
  expect(await lookupCollectorIdentities({ query } as unknown as Pool, groups, renew)).toHaveLength(601);
  expect(query).toHaveBeenCalledTimes(3);
  expect(renew).toHaveBeenCalledTimes(3);
  for (const args of query.mock.calls as unknown as [string, string[][]][]) expect(args[1][0].length).toBeLessThanOrEqual(300);
});

it('stops before the next lookup after ownership loss and skips empty input', async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  const pool = { query } as unknown as Pool;
  const renew = vi.fn(async () => { throw new Error('Collector ownership changed'); });
  expect(await lookupCollectorIdentities(pool, [], renew)).toEqual([]);
  await expect(lookupCollectorIdentities(pool, [[{ sourceId: 's', upstreamId: 'a' }]], renew)).rejects.toThrow('ownership');
  expect(query).not.toHaveBeenCalled();
});
