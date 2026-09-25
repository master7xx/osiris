import type { planIdentityReconciliation } from './identity-reconciliation-plan';

type Groups = ReturnType<typeof planIdentityReconciliation>;
type Pair = Groups[number]['pair_reviews'][number];
export interface HistoricalPairReview { sampled_at: string; pair: Pair }
const reasons = new Set(['nearby_provider_events_require_review', 'possible_cross_provider_confirmation']);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid historical review');
  return value as Record<string, unknown>;
};
function validatedPair(value: unknown): Pair {
  const pair = object(value);
  for (const key of ['left_event', 'right_event', 'left_provider', 'right_provider', 'reason']) {
    if (typeof pair[key] !== 'string' || !pair[key].length) throw new Error('Invalid historical pair');
  }
  if (!reasons.has(pair.reason as string) || typeof pair.distance_km !== 'number' || !Number.isFinite(pair.distance_km) || pair.distance_km < 0 ||
      typeof pair.time_difference_seconds !== 'number' || !Number.isFinite(pair.time_difference_seconds) || pair.time_difference_seconds < 0) throw new Error('Invalid historical pair');
  return { left_event: pair.left_event as string, left_provider: pair.left_provider as string,
    right_event: pair.right_event as string, right_provider: pair.right_provider as string,
    reason: pair.reason as string, distance_km: pair.distance_km, time_difference_seconds: pair.time_difference_seconds };
}

/** Only semantic pair findings persist. Missing observations can legitimately become available. */
export function collectHistoricalPairReviews(reports: unknown[], epoch: string): HistoricalPairReview[] {
  const unique = new Map<string, HistoricalPairReview>();
  const add = (sampledAt: unknown, pair: unknown) => {
    if (typeof sampledAt !== 'string' || !Number.isFinite(Date.parse(sampledAt))) throw new Error('Invalid historical review time');
    const review = { sampled_at: new Date(sampledAt).toISOString(), pair: validatedPair(pair) };
    unique.set(JSON.stringify(review), review);
    if (unique.size > 10000) throw new Error('Historical pair review limit exceeded');
  };
  for (const value of reports) {
    const report = object(value), reconciliation = object(report.reconciliation);
    if (reconciliation.epoch !== epoch || !Array.isArray(reconciliation.groups)) throw new Error('Historical review epoch or groups mismatch');
    for (const value of reconciliation.groups) {
      const group = object(value);
      if (group.pair_reviews !== undefined && !Array.isArray(group.pair_reviews)) throw new Error('Invalid historical pairs');
      for (const pair of (group.pair_reviews ?? []) as unknown[]) add(report.sampled_at, pair);
    }
    if (reconciliation.historical_pair_reviews !== undefined && !Array.isArray(reconciliation.historical_pair_reviews)) throw new Error('Invalid historical reviews');
    for (const value of (reconciliation.historical_pair_reviews ?? []) as unknown[]) {
      const review = object(value);
      add(review.sampled_at, review.pair);
    }
  }
  return [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

/** Retain both sides even when the counterpart no longer has available observations. */
export function applyHistoricalPairReviews(groups: Groups, reviews: HistoricalPairReview[]) {
  return groups.map(group => {
    const holds = reviews.filter(({ pair }) => pair.left_event === group.stored_event_id || pair.right_event === group.stored_event_id);
    if (!holds.length) return group;
    return { ...group,
      action: 'manual_review', proposed_changes: null,
      blockers: [...new Set([...group.blockers, 'historical_pair_requires_review'])].sort(),
      historical_pair_reviews: holds };
  });
}
