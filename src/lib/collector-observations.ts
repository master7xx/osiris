import type { EventEvidence, FusedEvent, IncomingEvent } from './event-fusion';
const key = (evidence: EventEvidence) => JSON.stringify([evidence.source_id, evidence.upstream_id ?? null, evidence.url ?? null, evidence.published_at ?? null]);
/** Last actual upstream observation, never the time a retained signal was reprocessed. */
export function observationIndex(rows: { payload: IncomingEvent; observed_at: string | Date }[]) {
  const times = new Map<string, number>();
  for (const row of rows) for (const evidence of row.payload.evidence) {
    const stamp = new Date(row.observed_at).getTime();
    if (Number.isFinite(stamp)) times.set(key(evidence), Math.max(times.get(key(evidence)) ?? 0, stamp));
  }
  return (event: FusedEvent): string => {
    const stamp = event.evidence.reduce((latest, evidence) => Math.max(latest, times.get(key(evidence)) ?? 0), 0);
    if (!stamp) throw new Error('Event has no source observation timestamp');
    return new Date(stamp).toISOString();
  };
}
export function batches<T>(items: T[], size = 300): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Invalid batch size');
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/** Collection URLs are provenance, not unique report keys. */
export function collectorIdentities(event: FusedEvent) {
  const identities = event.evidence.filter(item => item.upstream_id || item.url)
    .map(item => ({ sourceId: item.source_id, upstreamId: item.upstream_id || item.url! }));
  return identities.length ? identities : [{ sourceId: 'fusion', upstreamId: event.id }];
}
