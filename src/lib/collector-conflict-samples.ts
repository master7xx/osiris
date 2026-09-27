import { createHash } from 'node:crypto';
import type { IdentityConflictReason } from './collector-identity-conflict';

export interface ConflictSample {
  reason: IdentityConflictReason;
  candidate_fingerprint: string;
  stored_events: { id: string; revision: string }[];
  stored_event_count: number;
  sources: string[];
  source_count: number;
}
/** Bounded diagnostic samples, deliberately excluding titles, payloads, URLs and upstream keys. */
export function conflictSample(reason: IdentityConflictReason, candidateId: string,
  matches: { id: string; revision: string }[], identities: { sourceId: string }[]): ConflictSample {
  const sources = [...new Set(identities.map(identity => identity.sourceId))].sort();
  return { reason, candidate_fingerprint: createHash('sha256').update(candidateId).digest('hex'),
    stored_events: matches.slice(0, 10).map(row => ({ id: row.id, revision: row.revision })),
    stored_event_count: matches.length, sources: sources.slice(0, 10), source_count: sources.length };
}
