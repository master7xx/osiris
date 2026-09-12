'use client';

export type ClientEventSourceState = 'healthy' | 'partial' | 'error';

export interface ClientEventSourceHealth {
  id: string;
  label: string;
  state: ClientEventSourceState;
  ok: boolean;
  duration_ms: number;
  events: number;
  source_count: number;
  healthy_sources: number;
  error?: string;
}

export interface ClientEventIngestSnapshot {
  total: number;
  mappable: number;
  confirmed: number;
  corroborating: number;
  unconfirmed: number;
  source_count: number;
  healthy_sources: number;
  generated_at?: string;
  categories: Record<string, number>;
  source_health: ClientEventSourceHealth[];
}

let snapshot: ClientEventIngestSnapshot | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function setEventIngestHealth(next: ClientEventIngestSnapshot) {
  snapshot = {
    ...next,
    categories: { ...(next.categories || {}) },
    source_health: Array.isArray(next.source_health)
      ? next.source_health.map(source => ({ ...source }))
      : [],
  };
  version += 1;
  listeners.forEach(listener => listener());
}

export function getEventIngestHealthSnapshot() {
  if (!snapshot) return null;
  return {
    ...snapshot,
    categories: { ...snapshot.categories },
    source_health: snapshot.source_health.map(source => ({ ...source })),
  };
}

export function getEventIngestHealthVersion() {
  return version;
}

export function subscribeEventIngestHealth(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
