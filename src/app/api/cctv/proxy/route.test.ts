import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/ssrf-guard', () => ({ validateHost: vi.fn(async () => ({ ok: true })) }));
import { GET } from './route';
afterEach(() => vi.unstubAllGlobals());
const request = () => new NextRequest('http://localhost/api/cctv/proxy?url=' + encodeURIComponent('https://cdn.skylinewebcams.com/frame.jpg'));
it('blocks redirect to a private target before making a second request', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
  vi.stubGlobal('fetch', fetchMock);
  expect((await GET(request())).status).toBe(502); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('returns only image content and rejects HTML from a provider', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<script>bad</script>', { headers: { 'content-type': 'text/html' } })));
  expect((await GET(request())).status).toBe(502);
});
it('serves a bounded JPEG frame', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } })));
  const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/jpeg');
});
