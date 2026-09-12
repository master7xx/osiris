import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { publicGeoIp } from '@/lib/geo-ip';

afterEach(() => vi.unstubAllGlobals());
const request = (ip: string) => new NextRequest('http://localhost/api/geo', { headers: { 'x-forwarded-for': ip } });

describe('geolocation addresses and fallback', () => {
  it.each(['::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0:0:0:0:0:0:0:1',
    '127.5.6.7', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1',
    'fc00::1', 'fd00::1', 'fe80::1', '100.64.0.1', 'bad/path', ''])('omits non-public input %s', ip => {
    expect(publicGeoIp(ip)).toBe('');
  });
  it.each(['172.15.1.1', '172.32.1.1', '8.8.8.8', '2606:4700:4700::1111'])('preserves routable input %s', ip => {
    expect(publicGeoIp(ip)).toBe(ip);
  });
  it('normalizes a public mapped IPv4 address', () => {
    expect(publicGeoIp('::ffff:8.8.8.8')).toBe('8.8.8.8');
  });
  it('never sends the Windows loopback from the export to any provider', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: true }))
      .mockResolvedValueOnce(Response.json({ error: true }))
      .mockResolvedValueOnce(Response.json({ status: 'success', lat: 0, lon: 0 }));
    vi.stubGlobal('fetch', fetcher);
    const response = await GET(request('::ffff:127.0.0.1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ lat: 0, lon: 0, lookup_scope: 'server-egress' });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://ipapi.co/json/', 'https://freeipapi.com/api/json',
      'http://ip-api.com/json/?fields=status,lat,lon,city,regionName,country,query,isp,org,as',
    ]);
  });
  it('accepts latitude zero and identifies client-IP lookup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ latitude: 0, longitude: 25, ip: '8.8.8.8' })));
    expect(await (await GET(request('8.8.8.8, 10.0.0.1'))).json()).toMatchObject({ lat: 0, lookup_scope: 'client-ip' });
  });
  it('rejects invalid coordinates and keeps trying fallback providers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ latitude: 91, longitude: 25 }))
      .mockResolvedValueOnce(Response.json({ latitude: 0, longitude: 0 })));
    expect(await (await GET(request('8.8.8.8'))).json()).toMatchObject({ lat: 0, lon: 0 });
  });
  it('retains 502 when all providers reject the lookup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: true })));
    expect((await GET(request('::1'))).status).toBe(502);
  });
});
