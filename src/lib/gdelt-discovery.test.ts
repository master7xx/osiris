import { describe, expect, it, vi } from 'vitest';
import { createGdeltDiscovery } from './gdelt-discovery';
import { sourceFailure, publicSourceFailure } from './source-failure';
function harness(fetcher: typeof fetch) {
  let time = Date.parse('2026-09-26T13:00:00Z');
  const waits: number[] = [];
  return { run: createGdeltDiscovery(['topic-a', 'topic-b', 'topic-c', 'topic-d'], fetcher, () => time, async ms => { waits.push(ms); time += ms; }),
    waits, now: () => time, advance: (ms: number) => { time += ms; } };
}
describe('bounded GDELT discovery', () => {
  it('coalesces concurrent collection and spaces requests without changing query coverage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ articles: [] }));
    // Each response body is consumed exactly once.
    fetcher.mockImplementation(async () => Response.json({ articles: [] }));
    const h = harness(fetcher);
    const first = h.run();
    expect(h.run()).toBe(first);
    expect((await first).completed).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(h.waits).toEqual([5000, 5000, 5000]);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('query'))).toEqual(['topic-a', 'topic-b', 'topic-c', 'topic-d']);
  });
  it('backs off timeouts, skips network during cooldown and resets after recovery', async () => {
    let failing = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (failing) throw new DOMException('Timed out', 'TimeoutError');
      return Response.json({ articles: [] });
    });
    const h = harness(fetcher);
    await expect(h.run()).rejects.toMatchObject({ failure: { kind: 'timeout', retry_at: new Date(h.now() + 90000).toISOString() } });
    await expect(h.run()).rejects.toMatchObject({ failure: { kind: 'timeout' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    h.advance(90000);
    await expect(h.run()).rejects.toMatchObject({ failure: { retry_at: new Date(h.now() + 180000).toISOString() } });
    h.advance(180000); failing = false;
    expect((await h.run()).completed).toBe(4);
    failing = true;
    // A new failure after recovery uses the initial 90-second backoff.
    const result = h.run().catch(error => error.failure);
    expect((await result).retry_at).toBe(new Date(h.now() + 90000).toISOString());
  });
  it.each(['600', 'Sat, 26 Sep 2026 13:10:00 GMT'])('honors Retry-After %s and releases rejected bodies', async retry => {
    const response = new Response('provider rejection', { status: 429, headers: { 'Retry-After': retry } });
    const cancel = vi.spyOn(response.body!, 'cancel');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const h = harness(fetcher);
    await expect(h.run()).rejects.toMatchObject({ failure: { kind: 'http', http_status: 429, retry_at: '2026-09-26T13:10:00.000Z' } });
    expect(cancel).toHaveBeenCalledTimes(1);
    h.advance(599000);
    await expect(h.run()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains successful articles on partial failure and rotates the next starting query', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ articles: [{ title: 'Retained' }] }))
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockImplementation(async () => Response.json({ articles: [] }));
    const h = harness(fetcher);
    expect(await h.run()).toMatchObject({ articles: [{ title: 'Retained' }], completed: 1, failure: { kind: 'http', http_status: 503 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    h.advance(90000); await h.run();
    expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('query')).toBe('topic-c');
  });
  it('identifies a body-read deadline as timeout even when the body throws AbortError', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    try {
      const response = new Response();
      response.json = async () => {
        controller.abort(new DOMException('Timed out', 'TimeoutError'));
        throw new DOMException('Body aborted', 'AbortError');
      };
      const h = harness(vi.fn<typeof fetch>().mockResolvedValue(response));
      await expect(h.run()).rejects.toMatchObject({ failure: { kind: 'timeout' } });
    } finally { timeout.mockRestore(); }
  });
  it.each([new Response('<html>not json</html>'), Response.json({ unexpected: true })])('rejects invalid response envelopes', async response => {
    const h = harness(vi.fn<typeof fetch>().mockResolvedValue(response));
    await expect(h.run()).rejects.toMatchObject({ failure: { kind: 'invalid_response' } });
  });
});
describe('safe source failure classification', () => {
  it('distinguishes network, timeout, cancellation and HTTP without exporting exception text', () => {
    expect(sourceFailure(new TypeError('fetch failed'))).toEqual({ kind: 'network' });
    expect(sourceFailure(new Error('secret', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }))).toEqual({ kind: 'timeout' });
    expect(sourceFailure(new DOMException('cancelled', 'AbortError'))).toEqual({ kind: 'cancelled' });
    expect(sourceFailure(new Error('GDACS HTTP 502'))).toEqual({ kind: 'http', http_status: 502 });
    expect(publicSourceFailure(sourceFailure(new Error('postgres://private-password')))).toEqual({ kind: 'unknown' });
    expect(publicSourceFailure({ kind: 'http', http_status: 200, retry_at: 'broken' })).toEqual({ kind: 'http' });
  });
});
