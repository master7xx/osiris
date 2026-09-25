import { collectHistoricalPairReviews, applyHistoricalPairReviews } from './identity-review-holds';
import { createHash } from 'node:crypto';
import type { identityConflictReport } from './identity-conflict-report';
import { planIdentityReconciliation } from './identity-reconciliation-plan';

export const SNAPSHOT_VERSION = 'identity-review-v1';
export const ALGORITHM_VERSION = 'hazard-pair-review-v2';
type Report = Awaited<ReturnType<typeof identityConflictReport>>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createIdentitySnapshot(report: Report, previousReports: unknown[] = []) {
  if (!report.snapshotData || !report.reconciliation) throw new Error('Snapshot data required');
  // Normalize database Dates before processing report provenance.
  report = JSON.parse(JSON.stringify(report)) as Report;
  const historical = collectHistoricalPairReviews([report, ...previousReports], report.reconciliation!.epoch);
  const trackedIds = new Set([...report.snapshotData!.requested_event_ids,
    ...historical.flatMap(({ pair }) => [pair.left_event, pair.right_event])]);
  report = { ...report, snapshotData: { ...report.snapshotData!, requested_event_ids: [...trackedIds].sort() } };
  const reconciliation = { ...report.reconciliation, historical_pair_reviews: historical };
  // JSON round-trip fixes Date serialization before calculating the checksum.
  const data = JSON.parse(JSON.stringify({ format: SNAPSHOT_VERSION, algorithm: ALGORITHM_VERSION, report: { ...report, reconciliation } }));
  return { data, checksum: digest(data) };
}

export function replayIdentitySnapshot(value: unknown) {
  const snapshot = value as ReturnType<typeof createIdentitySnapshot>;
  if (!snapshot?.data || snapshot.data.format !== SNAPSHOT_VERSION || ![ALGORITHM_VERSION, 'hazard-pair-review-v1'].includes(snapshot.data.algorithm) ||
      typeof snapshot.checksum !== 'string' || digest(snapshot.data) !== snapshot.checksum) {
    throw new Error('Invalid snapshot format, algorithm version or checksum');
  }
  const report = snapshot.data.report as Report;
  const data = report?.snapshotData;
  if (!data || !report.reconciliation || !Number.isFinite(Date.parse(String(report.sampled_at))) ||
      !Array.isArray(data.signals) || !Array.isArray(data.links) || !Array.isArray(data.history) ||
      !Array.isArray(data.events) || !Array.isArray(data.requested_event_ids)) throw new Error('Invalid snapshot structure');
  const historical = collectHistoricalPairReviews([report], report.reconciliation.epoch);
  const groups = applyHistoricalPairReviews(planIdentityReconciliation(data.signals, data.links), historical);
  const found = new Set(groups.map(group => group.stored_event_id));
  // A supersession marker explains absent parent links; this is not a fresh verification of children.
  const superseded = data.events.filter(event => {
    const ids: unknown = event.payload?.replaced_by;
    return Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && id !== event.id) &&
      !data.links.some(link => link.event_id === event.id);
  }).map(event => ({ event_id: event.id, replaced_by: event.payload.replaced_by as string[] }));
  const supersededIds = new Set(superseded.map(event => event.event_id));
  const { snapshotData: omitted, ...base } = report;
  void omitted;
  return { ...base, snapshot_checksum: snapshot.checksum, algorithm: ALGORITHM_VERSION,
    reconciliation: { ...report.reconciliation, groups, historical_pair_reviews: historical,
      superseded_events: superseded,
      unresolved_event_ids: data.requested_event_ids.filter(id => !found.has(id) && !supersededIds.has(id)),
      notes: [...report.reconciliation.notes,
        'Replayed from a fixed snapshot; current time and live database were not consulted.',
        'Requested events without identity links remain unresolved unless a saved supersession marker exists; child integrity is not reverified by replay.',
        'Historical semantic pair findings require explicit review even after source coordinates change or observations disappear.',
        'Checksum detects accidental changes; it does not authorize applying this plan.'] } };
}

/** Validated private inputs for offline tooling; never returned in the shareable report. */
export function identitySnapshotInputs(value: unknown) {
  replayIdentitySnapshot(value);
  return (value as ReturnType<typeof createIdentitySnapshot>).data.report as Report;
}
