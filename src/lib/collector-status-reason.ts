/** Only recognize messages emitted by our collector; never expose raw errors. */
export function collectorStatusReason(message: string | null) {
  if (message === null) return { category: 'none', level: 'none', skipped_candidates: null };
  const skipped = /^([1-9][0-9]*) candidates skipped: identity reconciliation required$/.exec(message);
  if (skipped) return {
    category: 'identity_reconciliation', level: 'warning', skipped_candidates: skipped[1],
  };
  const known: Record<string, string> = {
    'All candidates require identity reconciliation': 'identity_reconciliation',
    'Identity conflict: explicit reconciliation required': 'identity_reconciliation',
    'Revision conflict': 'revision_conflict',
    'All event sources unavailable': 'sources_unavailable',
    'Collector lease expired': 'collector_ownership',
    'Collector ownership changed': 'collector_ownership',
    'Collector lease required or expired': 'collector_ownership',
  };
  return {
    category: Object.hasOwn(known, message) ? known[message] : 'unclassified',
    level: 'error', skipped_candidates: null,
  };
}

/** Public replay endpoints must not return database/provider exception text. */
export function publicCollectorError(message: string | null): string | null {
  if (message === null) return null;
  return collectorStatusReason(message).category === 'unclassified' ? 'Event collection failed' : message;
}

/** Successful cycles with skipped identities are warnings, not failed refreshes. */
export function collectorRefreshError(message?: string | null): string | undefined {
  if (message == null || collectorStatusReason(message).level !== 'error') return undefined;
  return publicCollectorError(message) ?? undefined;
}
