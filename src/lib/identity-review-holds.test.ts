import { expect, it } from 'vitest';
import { collectHistoricalPairReviews, applyHistoricalPairReviews } from './identity-review-holds';
import { planIdentityReconciliation } from './identity-reconciliation-plan';

const pair = { left_event: 'a', right_event: 'b', left_provider: 'gdacs:WF:1', right_provider: 'gdacs:WF:2',
  reason: 'nearby_provider_events_require_review', distance_km: 1, time_difference_seconds: 0 };
const report = { sampled_at: '2026-09-16T00:00:00Z', reconciliation: { epoch: 'epoch', groups: [{ pair_reviews: [pair] }] } };

it('keeps both sides of an old cross-parent pair even if one side disappears', () => {
  const history = collectHistoricalPairReviews([report], 'epoch');
  for (const id of ['a', 'b']) {
    const groups = planIdentityReconciliation([], [{ event_id: id, source_id: 'gdacs', upstream_id: 'missing', revision: '1' }]);
    const guarded = applyHistoricalPairReviews(groups, history);
    expect(guarded[0].blockers).toContain('historical_pair_requires_review');
    expect(guarded[0].proposed_changes).toBeNull();
    expect(groups[0].blockers).not.toContain('historical_pair_requires_review');
  }
});
it('deduplicates carried history regardless of report order without resetting its timestamp', () => {
  const history = collectHistoricalPairReviews([report], 'epoch');
  const next = { sampled_at: '2030-01-01T00:00:00Z', reconciliation: { epoch: 'epoch', groups: [], historical_pair_reviews: history } };
  expect(collectHistoricalPairReviews([report, next, report], 'epoch')).toEqual(history);
  expect(collectHistoricalPairReviews([next, report], 'epoch')).toEqual(history);
});
it.each([
  { ...pair, distance_km: -1 }, { ...pair, time_difference_seconds: Infinity },
  { ...pair, left_event: '' }, { ...pair, reason: 'unknown' },
])('rejects malformed pair provenance', invalid => {
  expect(() => collectHistoricalPairReviews([{ ...report, reconciliation: { epoch: 'epoch', groups: [{ pair_reviews: [invalid] }] } }], 'epoch')).toThrow();
});
