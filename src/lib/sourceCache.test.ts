import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cachedSource, clearSourceCache } from './sourceCache';

type Cam = { id: string };
const cam = (id: string): Cam => ({ id });

beforeEach(() => clearSourceCache());

describe('cachedSource', () => {
  it('fetches once and serves the cached list afterwards', async () => {
    let calls = 0;
    const load = cachedSource<Cam>('t1', async () => { calls++; return [cam('a')]; });

    expect(await load()).toEqual([cam('a')]);
    expect(await load()).toEqual([cam('a')]);
    expect(calls).toBe(1);
  });

  it('refetches once the TTL has elapsed', async () => {
    let calls = 0;
    const load = cachedSource<Cam>('t2', async () => { calls++; return [cam(`v${calls}`)]; }, 10);

    await load();
    await new Promise((r) => setTimeout(r, 25));
    expect(await load()).toEqual([cam('v2')]);
    expect(calls).toBe(2);
  });

  // region=all fans out to every source at once — a cold cache must not
  // multiply into N concurrent upstream requests.
  it('collapses concurrent misses into a single upstream call', async () => {
    let calls = 0;
    const load = cachedSource<Cam>('t3', async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return [cam('a')];
    });

    const all = await Promise.all([load(), load(), load(), load()]);
    expect(calls).toBe(1);
    for (const r of all) expect(r).toEqual([cam('a')]);
  });

  it('keeps serving the last good list when a refresh throws', async () => {
    let mode: 'ok' | 'fail' = 'ok';
    const load = cachedSource<Cam>('t4', async () => {
      if (mode === 'fail') throw new Error('upstream down');
      return [cam('good')];
    }, 10);

    expect(await load()).toEqual([cam('good')]);
    mode = 'fail';
    await new Promise((r) => setTimeout(r, 25));
    // stale data rather than an empty layer
    expect(await load()).toEqual([cam('good')]);
  });

  it('treats an empty refresh as a failed one and holds the previous list', async () => {
    let mode: 'ok' | 'empty' = 'ok';
    const load = cachedSource<Cam>('t5', async () => (mode === 'ok' ? [cam('good')] : []), 10);

    await load();
    mode = 'empty';
    await new Promise((r) => setTimeout(r, 25));
    expect(await load()).toEqual([cam('good')]);
  });

  it('returns empty when the first fetch fails with nothing cached', async () => {
    const load = cachedSource<Cam>('t6', async () => { throw new Error('down'); });
    expect(await load()).toEqual([]);
  });

  it('backs off cold failures from completion time and recovers on one shared retry', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const load = cachedSource<Cam>('cold-retry', async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 12000));
        if (calls === 1) throw new Error('timeout');
        return [cam('recovered')];
      });
      const first = load();
      await vi.advanceTimersByTimeAsync(12000);
      expect(await first).toEqual([]);
      await vi.advanceTimersByTimeAsync(59999);
      expect(await load()).toEqual([]);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      const retries = [load(), load(), load()];
      await vi.advanceTimersByTimeAsync(12000);
      expect(await Promise.all(retries)).toEqual([[cam('recovered')], [cam('recovered')], [cam('recovered')]]);
      expect(calls).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps separate keys independent', async () => {
    const a = cachedSource<Cam>('t7a', async () => [cam('a')]);
    const b = cachedSource<Cam>('t7b', async () => [cam('b')]);
    expect(await a()).toEqual([cam('a')]);
    expect(await b()).toEqual([cam('b')]);
  });
});
