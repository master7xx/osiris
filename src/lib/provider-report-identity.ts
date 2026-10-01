import type { IncomingEvent } from './event-fusion';

/** Known adapter IDs identify reports; collection links remain clickable provenance. */
export function withProviderReportIdentity<T extends IncomingEvent>(event: T): T {
  let source: string | undefined;
  const firms = /^firms:(viirs|modis):\d+:\d+:\d{4}-\d{2}-\d{2}$/.exec(event.id);
  if (firms) source = `nasa-firms-${firms[1]}`;
  else if (/^eonet:.+/.test(event.id)) source = 'nasa-eonet';
  else if (/^cloudflare-outage:.+:[A-Z]{2}$/.test(event.id)) source = 'cloudflare-radar-outages';
  if (!source) return event;
  return { ...event, evidence: event.evidence.map(item => item.source_id === source
    ? { ...item, upstream_id: event.id } : item) };
}
