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
