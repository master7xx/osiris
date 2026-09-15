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
  const plan = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([eventId, links]) => {
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
  // Compare across stored parents too: an old fusion can separate two reports
  // of the same event into different historical groups.
  const members = plan.flatMap(group => group.partitions.map(partition => ({ group, partition })));
  const pairReviews: { left_event: string; left_provider: string; right_event: string;
    right_provider: string; reason: string; distance_km: number; time_difference_seconds: number }[] = [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const a = members[i], b = members[j];
    if (a.partition.source === b.partition.source && a.partition.provider_event_id === b.partition.provider_event_id) continue;
    let match: typeof pairReviews[number] | undefined;
    for (const x of a.partition.observations) for (const y of b.partition.observations) {
      if (x.category !== y.category || !['earthquake', 'wildfire'].includes(x.category)) continue;
      const coordinates = [x.lat, x.lng, y.lat, y.lng];
      if (!coordinates.every(v => v !== null && Number.isFinite(v)) ||
          Math.abs(x.lat!) > 90 || Math.abs(y.lat!) > 90 || Math.abs(x.lng!) > 180 || Math.abs(y.lng!) > 180) continue;
      const seconds = Math.abs(Date.parse(x.occurred_at) - Date.parse(y.occurred_at)) / 1000;
      const rad = Math.PI / 180;
      const h = Math.sin((y.lat! - x.lat!) * rad / 2) ** 2 +
        Math.cos(x.lat! * rad) * Math.cos(y.lat! * rad) * Math.sin((y.lng! - x.lng!) * rad / 2) ** 2;
      const distance = 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
      // Conservative review thresholds, never an automatic merge decision.
      if (!Number.isFinite(seconds) || distance > 25 || seconds > (x.category === 'earthquake' ? 900 : 86400)) continue;
      const reason = a.partition.source !== b.partition.source
        ? 'possible_cross_provider_confirmation' : 'nearby_provider_events_require_review';
      const candidate = { left_event: a.group.stored_event_id,
        left_provider: `${a.partition.source}:${a.partition.provider_event_id}`,
        right_event: b.group.stored_event_id,
        right_provider: `${b.partition.source}:${b.partition.provider_event_id}`,
        reason, distance_km: distance, time_difference_seconds: seconds };
      if (!match || distance < match.distance_km || (distance === match.distance_km && seconds < match.time_difference_seconds)) match = candidate;
    }
    if (match) {
      pairReviews.push(match);
      for (const group of [a.group, b.group]) {
        if (!group.blockers.includes(match.reason)) group.blockers.push(match.reason);
        group.blockers.sort();
        group.action = 'manual_review';
        group.proposed_changes = null;
      }
    }
  }
  return plan.map(group => ({ ...group, pair_reviews: pairReviews.filter(pair =>
    pair.left_event === group.stored_event_id || pair.right_event === group.stored_event_id) }));

}
