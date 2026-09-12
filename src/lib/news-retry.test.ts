import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test } from './news-aggregator';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function clock() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
}

describe('news retries', () => {
  it('gets a fresh usable timeout after the first 6.5-second deadline', async () => {
    clock(); const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signals.push(init.signal);
      if (signals.length === 1) return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
      expect(init.signal.aborted).toBe(false);
      return Promise.resolve(Response.json({ recovered: true }));
    }));
    const result = __test.fetchWithRetry('https://example.test/feed', {});
    await vi.advanceTimersByTimeAsync(6500);
    expect((await result).ok).toBe(true);
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1].aborted).toBe(false);
  });
  it('stops after two timed-out attempts', async () => {
    clock();
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
    vi.stubGlobal('fetch', fetcher);
    const rejected = expect(__test.fetchWithRetry('https://example.test/feed', {})).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(13000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('releases failed response body before retrying HTTP 503', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } });
    const cancel = vi.spyOn(body, 'cancel');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(body, { status: 503 })).mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetcher);
    expect((await __test.fetchWithRetry('https://example.test/feed', {})).status).toBe(200);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not retry HTTP 404', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await __test.fetchWithRetry('https://example.test/feed', {})).status).toBe(404);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
