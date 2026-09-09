export type SourceRuntimeState = 'healthy' | 'degraded' | 'cooldown';

export interface SourceHealthSnapshot {
  state: SourceRuntimeState;
  effective_weight: number;
  success_rate: number;
  avg_latency_ms: number;
  consecutive_failures: number;
  empty_streak: number;
  stale_streak: number;
  fresh_items: number;
  newest_item_at?: string;
  newest_age_minutes?: number;
  cooldown_until?: string;
  last_error?: string;
  last_success_at?: string;
  last_attempt_at?: string;
}

interface RuntimeRecord {
  successes: number;
  failures: number;
  latencyEwma: number;
  consecutiveFailures: number;
  emptyStreak: number;
  staleStreak: number;
  freshItems: number;
  newestItemAt?: number;
  cooldownUntil: number;
  lastError?: string;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
}

interface RuntimeState {
  records: Record<string, RuntimeRecord>;
}

declare global {
  // eslint-disable-next-line no-var
  var __OSIRIS_NEWS_SOURCE_HEALTH__: RuntimeState | undefined;
}

const ALPHA = 0.25;
const MAX_COOLDOWN_MS = 15 * 60_000;

function root(): RuntimeState {
  if (!globalThis.__OSIRIS_NEWS_SOURCE_HEALTH__) {
    globalThis.__OSIRIS_NEWS_SOURCE_HEALTH__ = { records: {} };
  }
  return globalThis.__OSIRIS_NEWS_SOURCE_HEALTH__;
}

function recordFor(id: string): RuntimeRecord {
  const state = root();
  if (!state.records[id]) {
    state.records[id] = {
      successes: 0,
      failures: 0,
      latencyEwma: 0,
      consecutiveFailures: 0,
      emptyStreak: 0,
      staleStreak: 0,
      freshItems: 0,
      cooldownUntil: 0,
    };
  }
  return state.records[id];
}

export function shouldProbeSource(id: string, now = Date.now()) {
  return recordFor(id).cooldownUntil <= now;
}

/**
 * Transport-level success. Latency is recorded for diagnostics only and never
 * changes source state or weight by itself.
 */
export function noteSourceSuccess(id: string, latencyMs: number, itemCount: number, now = Date.now()) {
  const record = recordFor(id);
  record.successes += 1;
  record.consecutiveFailures = 0;
  record.lastError = undefined;
  record.lastSuccessAt = now;
  record.lastAttemptAt = now;
  record.cooldownUntil = 0;
  record.emptyStreak = itemCount > 0 ? 0 : record.emptyStreak + 1;
  record.latencyEwma = record.latencyEwma
    ? record.latencyEwma * (1 - ALPHA) + latencyMs * ALPHA
    : latencyMs;
}

/**
 * Content-level health. The caller reports how many stories from this source
 * survived the live 24-hour news window. Staleness never creates cooldown: a
 * source that resumes publishing should be observed and recover immediately.
 */
export function noteSourceFreshness(
  id: string,
  freshItemCount: number,
  newestItemAt?: number,
  now = Date.now(),
) {
  const record = recordFor(id);
  record.freshItems = Math.max(0, freshItemCount);
  if (Number.isFinite(newestItemAt)) record.newestItemAt = newestItemAt;
  if (freshItemCount > 0) {
    record.staleStreak = 0;
  } else {
    record.staleStreak += 1;
  }
  // Freshness is an observation, not a transport attempt.
  if (record.newestItemAt && record.newestItemAt > now + 5 * 60_000) {
    record.newestItemAt = undefined;
  }
}

export function noteSourceFailure(id: string, error: string, latencyMs: number, now = Date.now()) {
  const record = recordFor(id);
  record.failures += 1;
  record.consecutiveFailures += 1;
  record.lastError = error;
  record.lastAttemptAt = now;
  record.latencyEwma = record.latencyEwma
    ? record.latencyEwma * (1 - ALPHA) + latencyMs * ALPHA
    : latencyMs;

  if (record.consecutiveFailures >= 2) {
    const exponent = Math.min(4, record.consecutiveFailures - 2);
    record.cooldownUntil = now + Math.min(MAX_COOLDOWN_MS, 60_000 * 2 ** exponent);
  }
}

export function sourceHealthMultiplier(id: string, now = Date.now()) {
  const record = recordFor(id);
  const attempts = record.successes + record.failures;
  const successRate = attempts ? record.successes / attempts : 1;

  let multiplier = 1;
  if (successRate < 0.95) multiplier *= 0.92;
  if (successRate < 0.8) multiplier *= 0.82;
  if (successRate < 0.6) multiplier *= 0.72;
  if (record.emptyStreak >= 2) multiplier *= 0.88;
  if (record.emptyStreak >= 4) multiplier *= 0.75;
  if (record.staleStreak >= 3) multiplier *= 0.9;
  if (record.staleStreak >= 6) multiplier *= 0.75;
  if (record.consecutiveFailures > 0) multiplier *= Math.max(0.55, 1 - record.consecutiveFailures * 0.12);
  if (record.cooldownUntil > now) multiplier *= 0.5;

  return Math.max(0.35, Math.min(1.05, multiplier));
}

export function getSourceHealthSnapshot(id: string, baseWeight = 1, now = Date.now()): SourceHealthSnapshot {
  const record = recordFor(id);
  const attempts = record.successes + record.failures;
  const successRate = attempts ? record.successes / attempts : 1;
  const inCooldown = record.cooldownUntil > now;
  const degraded = record.consecutiveFailures > 0
    || record.emptyStreak >= 2
    || record.staleStreak >= 3
    || successRate < 0.85;
  const newestAgeMinutes = record.newestItemAt
    ? Math.max(0, Math.round((now - record.newestItemAt) / 60_000))
    : undefined;

  return {
    state: inCooldown ? 'cooldown' : degraded ? 'degraded' : 'healthy',
    effective_weight: Number((baseWeight * sourceHealthMultiplier(id, now)).toFixed(3)),
    success_rate: Number(successRate.toFixed(3)),
    avg_latency_ms: Math.round(record.latencyEwma),
    consecutive_failures: record.consecutiveFailures,
    empty_streak: record.emptyStreak,
    stale_streak: record.staleStreak,
    fresh_items: record.freshItems,
    newest_item_at: record.newestItemAt ? new Date(record.newestItemAt).toISOString() : undefined,
    newest_age_minutes: newestAgeMinutes,
    cooldown_until: inCooldown ? new Date(record.cooldownUntil).toISOString() : undefined,
    last_error: record.lastError,
    last_success_at: record.lastSuccessAt ? new Date(record.lastSuccessAt).toISOString() : undefined,
    last_attempt_at: record.lastAttemptAt ? new Date(record.lastAttemptAt).toISOString() : undefined,
  };
}

export function resetSourceHealthForTests() {
  globalThis.__OSIRIS_NEWS_SOURCE_HEALTH__ = { records: {} };
}
