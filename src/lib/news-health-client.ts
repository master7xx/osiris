'use client';

export interface ClientNewsSourceHealth {
  id: string;
  name: string;
  kind: 'rss' | 'telegram';
  tier: 'editorial' | 'osint' | 'broadcaster';
  state: 'healthy' | 'degraded' | 'cooldown';
  ok: boolean;
  skipped?: boolean;
  duration_ms: number;
  items: number;
  weight: number;
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
  error?: string;
  last_error?: string;
}

let health: ClientNewsSourceHealth[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function setNewsSourceHealth(next: ClientNewsSourceHealth[]) {
  health = next.map(item => ({ ...item }));
  version += 1;
  listeners.forEach(listener => listener());
}

export function getNewsSourceHealth() {
  return health.map(item => ({ ...item }));
}

export function getNewsSourceHealthVersion() {
  return version;
}

export function subscribeNewsSourceHealth(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
