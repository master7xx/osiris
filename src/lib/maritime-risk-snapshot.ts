interface ChokepointRisk { name: string; risk: string }
interface Snapshot { generatedAt: number; chokepoints: ChokepointRisk[] }
declare global { var __OSIRIS_MARITIME_RISK__: Snapshot | undefined }
const MAX_AGE_MS = 120_000;

/** Tiny projection of an already completed maritime response; never starts ingestion. */
export function noteMaritimeRisk(chokepoints: ChokepointRisk[], now = Date.now()) {
  globalThis.__OSIRIS_MARITIME_RISK__ = { generatedAt: now, chokepoints: chokepoints.map(({ name, risk }) => ({ name, risk })) };
}
export function readMaritimeRisk(now = Date.now()) {
  const snapshot = globalThis.__OSIRIS_MARITIME_RISK__;
  const state = !snapshot ? 'unavailable' : now - snapshot.generatedAt > MAX_AGE_MS ? 'stale' : 'cached';
  return {
    state,
    observed_at: snapshot ? new Date(snapshot.generatedAt).toISOString() : null,
    chokepoints: state === 'cached' ? snapshot!.chokepoints.map(row => ({ ...row })) : [],
  };
}
