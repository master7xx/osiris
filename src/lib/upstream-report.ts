import type { EventEvidence } from './event-fusion';

/** Explicit provider identities take precedence over shared collection URLs and fuzzy text. */
export function explicitReportMatch(a: EventEvidence[], b: EventEvidence[]): boolean | undefined {
  const left = a.filter(item => item.upstream_id);
  const right = b.filter(item => item.upstream_id);
  if (!left.length && !right.length) return undefined;
  return left.some(x => right.some(y => x.source_id === y.source_id && x.upstream_id === y.upstream_id));
}
