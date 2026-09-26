export type IdentityConflictReason = 'multiple_stored_events' | 'repeated_stored_event';

/** Caller supplies distinct stored IDs. Inspect only: never reconcile or reserve a skipped ID. */
export function identityConflictReason(ids: readonly string[], accepted: { has(id: string): boolean }): IdentityConflictReason | undefined {
  if (ids.length > 1) return 'multiple_stored_events';
  if (ids.length === 1 && accepted.has(ids[0])) return 'repeated_stored_event';
  return undefined;
}
