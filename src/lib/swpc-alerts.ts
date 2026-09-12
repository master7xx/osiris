import type { IncomingEvent } from './event-fusion';

export const SWPC_ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json';
interface SwpcAlert { product_id: string; issue_datetime: string; message: string }

export async function fetchSwpcAlerts(): Promise<SwpcAlert[]> {
  const response = await fetch(SWPC_ALERTS_URL, {
    signal: AbortSignal.timeout(8000), cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`NOAA SWPC HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Invalid NOAA SWPC collection');
  if (!payload.every(validRow)) throw new Error('Invalid NOAA SWPC bulletin');
  return payload;
}

function validRow(row: unknown): row is SwpcAlert {
  if (!row || typeof row !== 'object') return false;
  const value = row as Partial<SwpcAlert>;
  return typeof value.product_id === 'string' && !!value.product_id.trim()
    && typeof value.issue_datetime === 'string' && !!value.issue_datetime.trim()
    && typeof value.message === 'string' && !!value.message.trim();
}

/** NOAA's JSON timestamps have no offset; they are UTC, never browser-local time. */
function issuedAt(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?$/.test(value)) return NaN;
  return Date.parse(value.replace(' ', 'T').replace(/Z?$/, 'Z'));
}

export function parseSwpcEvents(payload: unknown, now = Date.now()): IncomingEvent[] {
  if (!Array.isArray(payload)) throw new Error('Invalid NOAA SWPC collection');
  const reports = new Map<string, IncomingEvent>();
  for (const row of payload) {
    if (!validRow(row)) throw new Error('Invalid NOAA SWPC bulletin');
    const time = issuedAt(row.issue_datetime);
    if (!Number.isFinite(time)) throw new Error('Invalid NOAA SWPC issue time');
    if (time > now + 3600000 || now - time > 7 * 86400000) continue;
    const message = row.message.replace(/\r\n?/g, '\n').trim();
    const code = message.match(/^Space Weather Message Code:\s*(\S+)/im)?.[1] || row.product_id;
    const serial = message.match(/^Serial Number:\s*(\d+)/im)?.[1];
    const published = new Date(time).toISOString();
    const upstreamId = JSON.stringify([code, serial || published]);
    const headline = message.split('\n').map(line => line.trim()).find(line => /^(?:(?:CONTINUED|EXTENDED|CANCEL)\s+)?(?:ALERT|WARNING|WATCH|SUMMARY)\s*:/i.test(line)) || `${code} bulletin`;
    // Bulletin history, including cancellation notices, is not an active-warning registry.
    const cancelled = /^CANCEL\s/i.test(headline);
    const scale = [...message.matchAll(/NOAA Scale:\s*[GRS]([1-5])\b/gi)].map(match => Number(match[1]));
    const severity = cancelled ? 15 : scale.length ? [0, 40, 55, 70, 85, 95][Math.max(...scale)] : 35;
    const event: IncomingEvent = {
      id: `swpc:${upstreamId}`, title: `Space weather bulletin · ${headline}`,
      description: message, category: 'weather', occurred_at: published,
      discovered_at: new Date(now).toISOString(), location: 'Global / space weather',
      location_confidence: 0, severity,
      evidence: [{ source_id: 'noaa-swpc', source: 'NOAA / SWPC', kind: 'official', independent: true,
        weight: 1.2, upstream_id: upstreamId, url: SWPC_ALERTS_URL, published_at: published }],
      tags: ['space-weather', 'bulletin', code, ...(cancelled ? ['cancellation-notice'] : [])],
    };
    const previous = reports.get(upstreamId);
    if (!previous || Date.parse(previous.occurred_at) < time) reports.set(upstreamId, event);
  }
  return [...reports.values()];
}

export async function fetchSwpcEvents(): Promise<IncomingEvent[]> {
  return parseSwpcEvents(await fetchSwpcAlerts());
}
