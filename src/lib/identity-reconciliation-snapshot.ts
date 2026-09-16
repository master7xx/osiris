import { createHash } from 'node:crypto';
import type { identityConflictReport } from './identity-conflict-report';
import { planIdentityReconciliation } from './identity-reconciliation-plan';

export const SNAPSHOT_VERSION = 'identity-review-v1';
export const ALGORITHM_VERSION = 'hazard-pair-review-v1';
type Report = Awaited<ReturnType<typeof identityConflictReport>>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createIdentitySnapshot(report: Report) {
  if (!report.snapshotData || !report.reconciliation) throw new Error('Snapshot data required');
  // JSON round-trip fixes Date serialization before calculating the checksum.
  const data = JSON.parse(JSON.stringify({ format: SNAPSHOT_VERSION, algorithm: ALGORITHM_VERSION, report }));
  return { data, checksum: digest(data) };
}

export function replayIdentitySnapshot(value: unknown) {
  const snapshot = value as ReturnType<typeof createIdentitySnapshot>;
  if (!snapshot?.data || snapshot.data.format !== SNAPSHOT_VERSION || snapshot.data.algorithm !== ALGORITHM_VERSION ||
      typeof snapshot.checksum !== 'string' || digest(snapshot.data) !== snapshot.checksum) {
    throw new Error('Invalid snapshot format, algorithm version or checksum');
  }
  const report = snapshot.data.report as Report;
  const data = report?.snapshotData;
  if (!data || !report.reconciliation || !Number.isFinite(Date.parse(String(report.sampled_at))) ||
      !Array.isArray(data.signals) || !Array.isArray(data.links) || !Array.isArray(data.history) ||
      !Array.isArray(data.events) || !Array.isArray(data.requested_event_ids)) throw new Error('Invalid snapshot structure');
  const groups = planIdentityReconciliation(data.signals, data.links);
  const found = new Set(groups.map(group => group.stored_event_id));
  const { snapshotData: omitted, ...base } = report;
  void omitted;
  return { ...base, snapshot_checksum: snapshot.checksum, algorithm: ALGORITHM_VERSION,
    reconciliation: { ...report.reconciliation, groups,
      unresolved_event_ids: data.requested_event_ids.filter(id => !found.has(id)),
      notes: [...report.reconciliation.notes,
        'Replayed from a fixed snapshot; current time and live database were not consulted.',
        'Requested events with no stored identity links remain unresolved; absence is not resolution.',
        'Checksum detects accidental changes; it does not authorize applying this plan.'] } };
}
