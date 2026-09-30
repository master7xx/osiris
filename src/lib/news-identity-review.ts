import { createHash } from 'node:crypto';
import { fuseEvents, isNewsEvent, type IncomingEvent } from './event-fusion';
import { collectorIdentities } from './collector-observations';
import type { StoredIdentityLink } from './identity-reconciliation-plan';
const key = (source: string, upstream: string) => JSON.stringify([source, upstream]);
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');

/** Present current news associations for review, never infer provider incident IDs or authorize moves. */
export function reviewNewsIdentities(signals: IncomingEvent[], links: StoredIdentityLink[], now: number) {
  const newsSources = new Set(signals.filter(isNewsEvent).flatMap(signal => signal.evidence.map(e => e.source_id)));
  const newsLinks = links.filter(link => link.source_id.startsWith('news:') || newsSources.has(link.source_id));
  const wanted = new Set(newsLinks.map(link => key(link.source_id, link.upstream_id)));
  const observations = new Map<string, IncomingEvent[]>();
  for (const signal of signals) for (const evidence of signal.evidence) {
    const upstream = evidence.upstream_id || evidence.url;
    if (!upstream) continue;
    const k = key(evidence.source_id, upstream);
    if (wanted.has(k)) {
      const rows = observations.get(k) ?? [];
      if (!rows.includes(signal)) rows.push(signal);
      observations.set(k, rows);
    }
  }
  // Use all signals: an official report may corroborate a news report.
  const current = fuseEvents(signals, { now, limit: signals.length });
  const byIdentity = new Map<string, Set<string>>();
  const candidates = new Map<string, { fingerprint: string; title: string; occurred_at: string; sources: string[] }>();
  for (const event of current) {
    const f = fingerprint(JSON.stringify([event.id, event.title, event.description, Boolean(event.withdrawn),
      collectorIdentities(event).map(identity => key(identity.sourceId, identity.upstreamId)).sort()]));
    for (const identity of collectorIdentities(event)) {
      const k = key(identity.sourceId, identity.upstreamId);
      if (!wanted.has(k)) continue;
      const groups = byIdentity.get(k) ?? new Set(); groups.add(f); byIdentity.set(k, groups);
      candidates.set(f, { fingerprint: f, title: event.title, occurred_at: event.occurred_at, sources: event.evidence.map(e => e.source_id).filter((value, index, all) => all.indexOf(value) === index).sort() });
    }
  }
  const linksByEvent = new Map<string, StoredIdentityLink[]>();
  for (const link of newsLinks) {
    const rows = linksByEvent.get(link.event_id) ?? []; rows.push(link); linksByEvent.set(link.event_id, rows);
  }
  const newsLinkSet = new Set(newsLinks);
  const nonNewsCounts = new Map<string, number>();
  for (const link of links) if (!newsLinkSet.has(link)) nonNewsCounts.set(link.event_id, (nonNewsCounts.get(link.event_id) ?? 0) + 1);
  const storedIds = [...linksByEvent.keys()].sort();
  const reviews = storedIds.map(id => {
    const rows = linksByEvent.get(id)!;
    const identities = rows.map(link => {
      const k = key(link.source_id, link.upstream_id);
      const seen = observations.get(k) ?? [];
      const groups = [...(byIdentity.get(k) ?? [])].sort();
      return { source: link.source_id, fingerprint: fingerprint(k), current_groups: groups,
        status: !seen.length ? 'missing_observation' : !groups.length ? 'excluded_from_current_fusion' : groups.length > 1 ? 'ambiguous_current_identity' : 'observed',
        observations: seen.map(signal => ({ title: signal.title, occurred_at: signal.occurred_at, lat: signal.lat, lng: signal.lng })) };
    }).sort((a,b) => a.fingerprint.localeCompare(b.fingerprint));
    const nonNewsIdentityCount = nonNewsCounts.get(id) ?? 0;
    return { stored_event_id: id, expected_revision: rows[0].revision, identities, non_news_identity_count: nonNewsIdentityCount,
      current_groups: [...new Set(identities.flatMap(identity => identity.current_groups))].sort(),
      incomplete: nonNewsIdentityCount > 0 || identities.some(identity => identity.status !== 'observed') || new Set(rows.map(row => row.revision)).size !== 1 };
  });
  const byStoredId = new Map(reviews.map(review => [review.stored_event_id, review]));
  const byCurrentGroup = new Map<string, string[]>();
  for (const review of reviews) for (const group of review.current_groups) {
    const ids = byCurrentGroup.get(group) ?? []; ids.push(review.stored_event_id); byCurrentGroup.set(group, ids);
  }
  const pending = new Set(storedIds);
  const components = [];
  while (pending.size) {
    const first = pending.values().next().value!;
    const ids = new Set([first]);
    const groups = new Set<string>();
    const queue = [first]; pending.delete(first);
    for (let position = 0; position < queue.length; position++) {
      const review = byStoredId.get(queue[position])!;
      for (const group of review.current_groups) {
        if (groups.has(group)) continue;
        groups.add(group);
        for (const id of byCurrentGroup.get(group) ?? []) if (!ids.has(id)) {
          ids.add(id); queue.push(id); pending.delete(id);
        }
      }
    }
    const members = [...ids].map(id => byStoredId.get(id)!);
    const incomplete = members.some(review => review.incomplete);
    components.push({ stored_event_ids: [...ids].sort(), current_groups: [...groups].sort(),
      action: incomplete ? 'review_missing_or_ambiguous_observations' : ids.size > 1 && groups.size > 1 ? 'review_overlap'
        : ids.size > 1 ? 'review_merge' : groups.size > 1 ? 'review_split' : 'review_consistent',
      executable: false });
  }
  return { mode: 'review-only', executable: false, stored_events: reviews,
    current_groups: [...candidates.values()].sort((a,b) => a.fingerprint.localeCompare(b.fingerprint)), components,
    notes: ['Groups reflect current fusion rules, not verified historical truth or cross-language semantic equivalence.',
      'All actions require content/history review. This report does not allocate UUIDs, move identities or authorize a database mutation.',
      'Missing or ambiguous identities block a complete proposal; past signals may have expired from the retained window.',
      'Raw upstream keys, URLs and descriptions are omitted. Titles are included for review.'] };
}
