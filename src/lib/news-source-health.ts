export type SourceRuntimeState = 'healthy' | 'degraded' | 'cooldown';

export interface SourceHealthSnapshot {
  state: SourceRuntimeState;
  effective_weight: number;
  success_rate: number;
  avg_latency_ms: number;
  consecutive_failures: number;
  empty_streak: number;
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
const SLOW_MS = 2500;
const VERY_SLOW_MS = 5000;
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
      cooldownUntil: 0,
    };
  }
  return state.records[id];
}

export function shouldProbeSource(id: string, now = Date.now()) {
  return recordFor(id).cooldownUntil <= now;
}

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
  if (record.latencyEwma > SLOW_MS) multiplier *= 0.9;
  if (record.latencyEwma > VERY_SLOW_MS) multiplier *= 0.82;
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
    || successRate < 0.85
    || record.latencyEwma > SLOW_MS;

  return {
    state: inCooldown ? 'cooldown' : degraded ? 'degraded' : 'healthy',
    effective_weight: Number((baseWeight * sourceHealthMultiplier(id, now)).toFixed(3)),
    success_rate: Number(successRate.toFixed(3)),
    avg_latency_ms: Math.round(record.latencyEwma),
    consecutive_failures: record.consecutiveFailures,
    empty_streak: record.emptyStreak,
    cooldown_until: inCooldown ? new Date(record.cooldownUntil).toISOString() : undefined,
    last_error: record.lastError,
    last_success_at: record.lastSuccessAt ? new Date(record.lastSuccessAt).toISOString() : undefined,
    last_attempt_at: record.lastAttemptAt ? new Date(record.lastAttemptAt).toISOString() : undefined,
  };
}

export function resetSourceHealthForTests() {
  globalThis.__OSIRIS_NEWS_SOURCE_HEALTH__ = { records: {} };
}
