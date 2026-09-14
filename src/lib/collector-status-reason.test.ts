import { expect, it } from 'vitest';
import { collectorStatusReason } from './collector-status-reason';

it('distinguishes a successful cycle with skipped candidates from failed reconciliation', () => {
  expect(collectorStatusReason('17 candidates skipped: identity reconciliation required'))
    .toEqual({ category: 'identity_reconciliation', level: 'warning', skipped_candidates: '17' });
  expect(collectorStatusReason('All candidates require identity reconciliation'))
    .toEqual({ category: 'identity_reconciliation', level: 'error', skipped_candidates: null });
});
it('reports no saved error without claiming the collector is running', () => {
  expect(collectorStatusReason(null)).toEqual({ category: 'none', level: 'none', skipped_candidates: null });
});
it.each([
  ['All event sources unavailable', 'sources_unavailable'],
  ['Revision conflict', 'revision_conflict'],
  ['Collector lease expired', 'collector_ownership'],
  ['Collector ownership changed', 'collector_ownership'],
  ['Collector lease required or expired', 'collector_ownership'],
  ['Identity conflict: explicit reconciliation required', 'identity_reconciliation'],
])('classifies the exact message %s', (message, category) => {
  expect(collectorStatusReason(message)).toEqual({ category, level: 'error', skipped_candidates: null });
});
it.each(['postgres://user:secret@private/db', '17 candidates skipped: identity reconciliation required secret', '', 'constructor', '__proto__'])
('redacts unrecognized messages: %s', message => {
  expect(collectorStatusReason(message)).toEqual({ category: 'unclassified', level: 'error', skipped_candidates: null });
});
