import { isIP } from 'node:net';

/** Normalize literal addresses only; never interpolate a hostname/path from proxy headers. */
export function publicGeoIp(input: string): string {
  let ip = input.trim().replace(/^\[([^\]]+)\]$/, '$1');
  const family = isIP(ip);
  if (!family || ip.includes('%')) return '';
  if (family === 6) {
    ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    // WHATWG canonicalization converts both dotted and expanded mapped forms to hex.
    const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const hi = parseInt(mapped[1], 16); const lo = parseInt(mapped[2], 16);
      return publicGeoIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (ip === '::' || ip === '::1' || /^(?:fc|fd|fe[89ab]|ff)/.test(ip)) return '';
    return ip;
  }
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224
    || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127) return '';
  return ip;
}

export function validGeoCoordinates(lat: unknown, lon: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180;
}
