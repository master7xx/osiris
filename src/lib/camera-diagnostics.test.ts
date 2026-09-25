import { describe, expect, it, vi } from 'vitest';
import { CameraDiagnostics } from './camera-diagnostics';
describe('camera diagnostics', () => {
  it('only probes registered cameras and caches/coalesces checks, including catalog refreshes', async () => {
    let now = 1000000;
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const service = new CameraDiagnostics(fetcher, () => now);
    expect((await service.check('unknown')).state).toBe('UNKNOWN');
    const cameras = [{ id: 'one', stream_url: 'https://example.com/one', source: 'provider' }];
    service.register(cameras);
    const first = service.check('one'); service.register(cameras);
    expect(await service.check('one')).toEqual(await first);
    await service.check('one'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual(['https://example.com/one', expect.objectContaining({ method: 'HEAD' })]);
    now += 300001; await service.check('one'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('respects provider spacing and Retry-After across different cameras', async () => {
    let now = 1000000;
    const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }));
    const service = new CameraDiagnostics(fetcher, () => now);
    service.register(['a','b'].map(id => ({ id, feed_url: `https://example.com/${id}`, source: 'provider' })));
    const result = await service.check('a');
    expect(result.httpStatus).toBe(429);
    now += 3500000; expect((await service.check('b')).state).toBe('QUEUED');
    expect(fetcher).toHaveBeenCalledTimes(1);
    service.register([{ id: 'b', feed_url: 'https://example.com/b', source: 'provider' }]);
    now += 100001; await service.check('b'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not report HEAD unsupported or transport failures as broken playback', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 405 })).mockRejectedValueOnce(new Error('private details'));
    const service = new CameraDiagnostics(request);
    service.register([{ id: 'a', feed_url: 'https://a.example/frame' }, { id: 'b', feed_url: 'https://b.example/frame' }]);
    expect((await service.check('a')).state).toBe('HEAD_UNSUPPORTED');
    expect(await service.check('b')).toMatchObject({ state: 'NETWORK_OR_TIMEOUT' });
  });
});
