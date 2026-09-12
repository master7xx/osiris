import type { ContinuousEvent } from './event-ledger';

export function canonicalReportUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    url.hash = '';
    if (url.hostname === 'api.weather.gov' && url.pathname.startsWith('/alerts/')) {
      url.pathname = '/alerts/' + encodeURIComponent(decodeURIComponent(url.pathname.slice(8)));
    }
    if (url.hostname === 't.me' || url.hostname === 'telegram.me') {
      url.hostname = 't.me'; url.protocol = 'https:';
      url.pathname = url.pathname.replace(/^\/s\//, '/').replace(/\/$/, '');
      url.search = '';
    }
    return url.href;
  } catch { return value; }
}

/** Exact report provenance only; title similarity must not collapse incidents. */
export function reportIdentity(event: ContinuousEvent): string {
  const evidence = event.evidence ?? [];
  const urls = evidence.filter(item => item.url).map(item => [item.source_id, canonicalReportUrl(item.url!)]);
  if (urls.length) return JSON.stringify([urls.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  if (!event.title || !event.occurred_at || (!evidence.length && !event.sources?.length)) return `id:${event.id}`;
  return JSON.stringify([event.category, event.occurred_at, event.title, event.description,
    [...new Set(evidence.map(item => item.source_id))].sort(), [...(event.sources ?? [])].sort()]);
}

/** Prefer the latest observed copy; ties prefer later input (fresh response). */
export function deduplicateReports(events: ContinuousEvent[]): ContinuousEvent[] {
  const byId = new Map(events.map(event => [event.id, event]));
  const reports = new Map<string, ContinuousEvent>();
  for (const event of byId.values()) {
    const key = reportIdentity(event);
    const previous = reports.get(key);
    if (!previous || !(Date.parse(previous.last_observed_at) > Date.parse(event.last_observed_at))) reports.set(key, event);
  }
  return [...reports.values()];
}
