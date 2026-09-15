import { createHash } from 'node:crypto';
import type { IncomingEvent } from './event-fusion';

export interface StoredIdentityLink {
  source_id: string; upstream_id: string; event_id: string; revision: string;
}
const key = (source: string, id: string) => JSON.stringify([source, id]);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Strict adapter IDs only. Synthetic GDACS location/title fallbacks need review. */
function providerIdentity(signal: IncomingEvent) {
  if (/^usgs:[a-zA-Z0-9_-]+$/.test(signal.id)) return { source: 'usgs-earthquakes', id: signal.id.slice(5) };
  if (/^gdacs:[A-Z]{2}:[0-9]+$/.test(signal.id)) return { source: 'gdacs', id: signal.id.slice(6) };
  return null;
}

/** Review proposals, never executable mutations or automatically allocated UUIDs. */
export function planIdentityReconciliation(signals: IncomingEvent[], stored: StoredIdentityLink[]) {
  const observations = new Map<string, Set<string>>();
  for (const signal of signals) {
    const provider = providerIdentity(signal);
    for (const evidence of signal.evidence) {
      const upstream = evidence.upstream_id || evidence.url;
      if (!upstream) continue;
      const k = key(evidence.source_id, upstream);
      const ids = observations.get(k) ?? new Set<string>();
      ids.add(provider && provider.source === evidence.source_id ? key(provider.source, provider.id) : 'unknown');
      observations.set(k, ids);
    }
  }
  const groups = new Map<string, StoredIdentityLink[]>();
  for (const link of stored) groups.set(link.event_id, [...(groups.get(link.event_id) ?? []), link]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([eventId, links]) => {
    const blockers = new Set<string>();
    const partitions = new Map<string, string[]>();
    const unresolved = [];
    for (const link of links) {
      const k = key(link.source_id, link.upstream_id);
      const ids = observations.get(k);
      let reason: string | null = null;
      if (!ids) reason = 'identity_not_in_retained_signals';
      else if (ids.has('unknown')) reason = 'provider_id_unverified';
      else if (ids.size !== 1) reason = 'identity_shared_by_distinct_provider_ids';
      if (reason) {
        blockers.add(reason);
        unresolved.push({ source: link.source_id, identity_fingerprint: hash(k), reason });
      } else {
        const provider = [...ids!][0];
        partitions.set(provider, [...(partitions.get(provider) ?? []), hash(k)]);
      }
    }
    const sources = new Set([...partitions.keys()].map(p => JSON.parse(p)[0] as string));
    if (sources.size > 1) blockers.add('cross_provider_correspondence_requires_review');
    if (new Set(links.map(l => l.revision)).size !== 1) blockers.add('inconsistent_revision');
    const members = [...partitions].sort(([a], [b]) => a.localeCompare(b)).map(([provider, identities]) => {
      const [source, provider_event_id] = JSON.parse(provider) as [string, string];
      const observations = signals.filter(signal => {
        const p = providerIdentity(signal);
        return p?.source === source && p.id === provider_event_id;
      }).map(signal => ({ title: signal.title, occurred_at: signal.occurred_at,
        discovered_at: signal.discovered_at, lat: signal.lat ?? null, lng: signal.lng ?? null,
        category: signal.category })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return { source, provider_event_id, observations, identity_fingerprints: identities.sort(),
        proposed_target: `new-event:${hash(provider)}` };
    });
    const split = !blockers.size && members.length > 1;
    return { stored_event_id: eventId, expected_revision: links[0].revision,
      action: split ? 'propose_split_for_review' : 'manual_review',
      blockers: [...blockers].sort(), partitions: members, unresolved,
      identity_count: links.length,
      proposed_changes: split ? {
        identity_moves: members.map(m => ({ fingerprints: m.identity_fingerprints, from: eventId, to: m.proposed_target })),
        original_event: 'preserve_history_and_record_supersession_if_approved',
      } : null,
    };
  });
}
