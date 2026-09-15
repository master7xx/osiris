import { expect, it } from 'vitest';
import { planIdentityReconciliation, type StoredIdentityLink } from './identity-reconciliation-plan';
import type { IncomingEvent } from './event-fusion';
const signal = (id: string, upstream: string, source = 'usgs-earthquakes'): IncomingEvent => ({
  id, title: 'Earthquake', category: 'earthquake', occurred_at: '2026-09-15T00:00:00Z',
  discovered_at: '2026-09-15T00:01:00Z', severity: 50,
  evidence: [{ source_id: source, source, kind: 'sensor', independent: true, weight: 1, url: upstream }],
});
const link = (upstream_id: string, source_id = 'usgs-earthquakes'): StoredIdentityLink => ({
  source_id, upstream_id, event_id: 'stored', revision: '4',
});
it('proposes a reviewable split for distinct IDs with all stored identities covered', () => {
  const plan = planIdentityReconciliation([signal('usgs:a', 'url-a'), signal('usgs:b', 'url-b')], [link('url-a'), link('url-b')])[0];
  expect(plan.action).toBe('propose_split_for_review');
  expect(plan.partitions.map(p => p.provider_event_id)).toEqual(['a', 'b']);
  expect(plan.proposed_changes?.identity_moves).toHaveLength(2);
  expect(plan.expected_revision).toBe('4');
});
it('groups updates with one provider ID and does not propose splitting them', () => {
  const plan = planIdentityReconciliation([signal('gdacs:EQ:42', 'episode1', 'gdacs'), signal('gdacs:EQ:42', 'episode2', 'gdacs')],
    [link('episode1', 'gdacs'), link('episode2', 'gdacs')])[0];
  expect(plan.partitions).toHaveLength(1);
  expect(plan.partitions[0].provider_event_id).toBe('EQ:42');
  expect(plan.proposed_changes).toBeNull();
});
it('blocks missing historical keys instead of silently dropping them', () => {
  const plan = planIdentityReconciliation([signal('usgs:a', 'a'), signal('usgs:b', 'b')], [link('a'), link('b'), link('expired')])[0];
  expect(plan.blockers).toContain('identity_not_in_retained_signals');
  expect(plan.proposed_changes).toBeNull();
  expect(plan.identity_count).toBe(3);
});
it('blocks a shared URL used by distinct provider IDs', () => {
  const plan = planIdentityReconciliation([signal('usgs:a', 'same'), signal('usgs:b', 'same')], [link('same')])[0];
  expect(plan.blockers).toContain('identity_shared_by_distinct_provider_ids');
  expect(plan.partitions).toEqual([]);
});
it('blocks synthetic GDACS IDs, editorial identities and unverified observations', () => {
  const plan = planIdentityReconciliation([signal('gdacs:FL:10-20-title', 'a', 'gdacs'), signal('news:1', 'b', 'news:bbc')],
    [link('a', 'gdacs'), link('b', 'news:bbc')])[0];
  expect(plan.blockers).toContain('provider_id_unverified');
  expect(plan.proposed_changes).toBeNull();
});
it('does not infer cross-provider correspondence', () => {
  const plan = planIdentityReconciliation([signal('usgs:a', 'a'), signal('gdacs:EQ:42', 'b', 'gdacs')],
    [link('a'), link('b', 'gdacs')])[0];
  expect(plan.blockers).toContain('cross_provider_correspondence_requires_review');
});
it('omits raw keys and creates deterministic symbolic references regardless of order', () => {
  const signals = [signal('usgs:a', 'https://example.test/a?secret=x'), signal('usgs:b', 'private-b')];
  const links = [link('https://example.test/a?secret=x'), link('private-b')];
  const plan = planIdentityReconciliation(signals, links);
  expect(JSON.stringify(plan)).not.toContain('secret');
  expect(JSON.stringify(plan)).not.toContain('private-b');
  expect(planIdentityReconciliation([...signals].reverse(), [...links].reverse())).toEqual(plan);
});

it('withholds nearby wildfire partitions and leaves distant fires reviewable', () => {
  const fires = [0, 0.005, 8].map((lat, i) => ({ ...signal(`gdacs:WF:${i}`, `fire-${i}`, 'gdacs'), category: 'wildfire' as const, lat, lng: 20 }));
  const links = fires.map((_, i) => link(`fire-${i}`, 'gdacs'));
  const near = planIdentityReconciliation(fires, links)[0];
  expect(near.action).toBe('manual_review');
  expect(near.proposed_changes).toBeNull();
  expect(near.pair_reviews).toHaveLength(1);
  expect(near.pair_reviews[0].distance_km).toBeLessThan(1);
  expect(planIdentityReconciliation([fires[0], fires[2]], [links[0], links[2]])[0].action).toBe('propose_split_for_review');
});

it('flags cross-provider confirmations without splitting them automatically', () => {
  const signals = [signal('usgs:a', 'a'), signal('gdacs:EQ:42', 'b', 'gdacs')].map(s => ({ ...s, lat: 2.4223, lng: 128.1704 }));
  signals[1].occurred_at = '2026-09-15T00:00:00.500Z';
  const group = planIdentityReconciliation(signals, [link('a'), link('b', 'gdacs')])[0];
  expect(group.pair_reviews[0]).toMatchObject({ reason: 'possible_cross_provider_confirmation', distance_km: 0, time_difference_seconds: 0.5 });
  expect(group.proposed_changes).toBeNull();
});

it('checks proximity across parents, independent of input order', () => {
  const signals = [signal('usgs:a', 'a'), signal('usgs:b', 'b')].map(s => ({ ...s, lat: 19, lng: -65 }));
  const links = [link('a'), { ...link('b'), event_id: 'another-parent' }];
  const plan = planIdentityReconciliation(signals, links);
  expect(plan.every(g => g.pair_reviews.length === 1 && g.blockers.includes('nearby_provider_events_require_review'))).toBe(true);
  expect(planIdentityReconciliation([...signals].reverse(), [...links].reverse())).toEqual(plan);
  signals[1].occurred_at = '2026-09-15T01:00:00Z';
  expect(planIdentityReconciliation(signals, links).every(g => !g.pair_reviews.length)).toBe(true);
});
