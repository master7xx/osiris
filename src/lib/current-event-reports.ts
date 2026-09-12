import type { ContinuousEvent } from './event-ledger';
import { canonicalReportUrl } from './event-identity';

/** Apply source-issued lifecycle before category/limit filtering, preserving history. */
export function currentEventReports(events: ContinuousEvent[], now: number): ContinuousEvent[] {
  const retired = new Map<string, number>();
  for (const event of events) {
    if (!(event.evidence ?? []).some(item => item.source_id === 'noaa-nws')) continue;
    for (const url of event.supersedes ?? []) {
      const key = canonicalReportUrl(url);
      retired.set(key, Math.max(retired.get(key) ?? 0, Date.parse(event.occurred_at)));
    }
  }
  return events.filter(event => {
    if (event.withdrawn) return false;
    const nwsOnly = (event.evidence?.length ?? 0) > 0 && event.evidence.every(item => item.source_id === 'noaa-nws');
    if (!nwsOnly) return true;
    if (event.tags?.some(tag => tag.startsWith('expires:') && Date.parse(tag.slice(8)) <= now)) return false;
    return !(event.evidence ?? []).some(item => item.url && (retired.get(canonicalReportUrl(item.url)) ?? 0) >= Date.parse(event.occurred_at));
  });
}
