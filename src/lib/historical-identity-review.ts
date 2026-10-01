import { createHash } from 'node:crypto';
import type { IncomingEvent } from './event-fusion';
import type { StoredIdentityLink } from './identity-reconciliation-plan';

const key = (source: string, upstream: string) => JSON.stringify([source, upstream]);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Stored fused payloads are context, never reconstructed original articles. */
export function reviewHistoricalIdentities(links: StoredIdentityLink[], history: {
  event_id: string; revision: string; committed_at: string; payload: IncomingEvent;
}[]) {
  const index = new Map<string, { revision: string; committed_at: string; title: string;
    occurred_at: string; lat?: number; lng?: number; evidence_count: number }[]>();
  for (const row of history) {
    const keys = new Set(row.payload.evidence.flatMap(e => e.upstream_id || e.url
      ? [key(e.source_id, e.upstream_id || e.url!)] : []));
    for (const identity of keys) {
      const k = key(row.event_id, identity);
      const contexts = index.get(k) ?? [];
      contexts.push({ revision: row.revision, committed_at: row.committed_at,
        title: row.payload.title, occurred_at: row.payload.occurred_at,
        lat: row.payload.lat, lng: row.payload.lng, evidence_count: keys.size });
      index.set(k, contexts);
    }
  }
  const identities = links.map(link => {
    const contexts = (index.get(key(link.event_id, key(link.source_id, link.upstream_id))) ?? [])
      .sort((a, b) => Number(a.revision) - Number(b.revision));
    const singleton = contexts.filter(c => c.evidence_count === 1);
    const titles = new Set(singleton.map(c => c.title));
    const collection = link.source_id.startsWith('nasa-firms-')
      && link.upstream_id === 'https://firms.modaps.eosdis.nasa.gov/';
    return { stored_event_id: link.event_id, expected_revision: link.revision,
      source: link.source_id, identity_fingerprint: hash(key(link.source_id, link.upstream_id)),
      status: collection ? 'collection_key_requires_replacement' : !contexts.length ? 'missing_history'
        : !singleton.length ? 'composite_context_only' : titles.size > 1 ? 'multiple_singleton_titles' : 'singleton_context_available',
      contexts, executable: false };
  }).sort((a, b) => a.stored_event_id.localeCompare(b.stored_event_id) || a.identity_fingerprint.localeCompare(b.identity_fingerprint));
  return { mode: 'history-review-only', executable: false, identities,
    notes: ['Singleton contexts are stored event revisions, not proof of the original upstream content.',
      'Composite contexts cannot assign individual titles/descriptions/coordinates to their evidence keys.',
      'Collection keys require a separately reviewed replacement; no historical identities are moved.',
      'Different titles may be updates to one report; this review does not authorize a split or merge.'] };
}
