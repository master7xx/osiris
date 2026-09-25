export const EVENT_STALE_AFTER_MS = 180000;

/** Freshness is independent of provider success; a cached healthy result is historical. */
export function eventFreshness(generatedAt: string | undefined, now: number, cached = false) {
  const stamp = generatedAt ? Date.parse(generatedAt) : NaN;
  if (!Number.isFinite(stamp) || !Number.isFinite(now) || now <= 0) {
    return { stale: true, timestamp: 'Unknown', ageSeconds: null };
  }
  return {
    stale: cached || now - stamp > EVENT_STALE_AFTER_MS,
    timestamp: new Date(stamp).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'),
    ageSeconds: Math.max(0, Math.floor((now - stamp) / 1000)),
  };
}
