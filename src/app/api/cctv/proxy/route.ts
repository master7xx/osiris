import { NextRequest, NextResponse } from 'next/server';
import { cameraProxyTarget } from '@/lib/camera-proxy-target';
import { validateHost } from '@/lib/ssrf-guard';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw) return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  let target: URL;
  try { target = cameraProxyTarget(raw); } catch { return NextResponse.json({ error: 'Forbidden camera target' }, { status: 403 }); }
  const signal = AbortSignal.timeout(12000);
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const check = await validateHost(target.hostname);
      if (!check.ok) throw new Error('Blocked camera address');
      const noReferer = target.hostname === 'thb.gov.tw' || target.hostname.endsWith('.thb.gov.tw');
      const response = await fetch(target, { redirect: 'manual', signal, cache: 'no-store', headers: {
        Accept: 'image/*,*/*', 'User-Agent': 'Mozilla/5.0 Osiris-Camera-Proxy/1.0',
        ...(noReferer ? {} : { Referer: `${target.origin}/` }),
      } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || hop === 3) throw new Error('Camera redirect limit');
        target = cameraProxyTarget(location, target.href); continue;
      }
      if (!response.ok) { await response.body?.cancel(); return NextResponse.json({ error: `Upstream ${response.status}` }, { status: 502 }); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty camera response');
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > MAX_FRAME_BYTES) throw new Error('Camera frame too large');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const data = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      // Frames are images, never arbitrary active documents from an upstream host.
      const type = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw new Error('Unsupported camera frame');
      return new NextResponse(data, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=5, stale-while-revalidate=10', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' } });
    }
    throw new Error('Camera redirect limit');
  } catch { return NextResponse.json({ error: 'Camera proxy unavailable' }, { status: 502 }); }
}
