import { expect, it } from 'vitest';
import { identityConflictReason } from './collector-identity-conflict';
it('distinguishes ambiguity from repeat use without reserving skipped stored identities', () => {
  const accepted = new Set<string>();
  expect(identityConflictReason([], accepted)).toBeUndefined();
  expect(identityConflictReason(['a', 'b'], accepted)).toBe('multiple_stored_events');
  expect(identityConflictReason(['a'], accepted)).toBeUndefined();
  accepted.add('a');
  expect(identityConflictReason(['a'], accepted)).toBe('repeated_stored_event');
  expect(identityConflictReason(['a', 'b'], accepted)).toBe('multiple_stored_events');
  expect(identityConflictReason(['b'], accepted)).toBeUndefined();
  expect([...accepted]).toEqual(['a']);
});
