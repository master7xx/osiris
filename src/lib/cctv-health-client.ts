'use client';

export type ClientCctvProviderState = 'idle' | 'healthy' | 'partial' | 'error' | 'disabled';

export interface ClientCctvProviderScope {
  scope: string;
  state: ClientCctvProviderState;
  enabled: boolean;
  cameras: number;
  duration_ms?: number;
  last_attempt_at?: string;
  last_success_at?: string;
  last_error?: string;
}

export interface ClientCctvProviderHealth {
  id: 'opencctv' | 'windy' | 'official' | 'curated';
  label: string;
  kind: 'aggregator' | 'official' | 'curated';
  state: ClientCctvProviderState;
  enabled: boolean;
  cameras: number;
  response_cameras: number;
  duration_ms?: number;
  last_attempt_at?: string;
  last_success_at?: string;
  last_error?: string;
  scopes: ClientCctvProviderScope[];
}

let health: ClientCctvProviderHealth[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function setCctvProviderHealth(next: ClientCctvProviderHealth[]) {
  health = next.map(provider => ({
    ...provider,
    scopes: Array.isArray(provider.scopes) ? provider.scopes.map(scope => ({ ...scope })) : [],
  }));
  version += 1;
  listeners.forEach(listener => listener());
}

export function getCctvProviderHealthSnapshot() {
  return health.map(provider => ({
    ...provider,
    scopes: provider.scopes.map(scope => ({ ...scope })),
  }));
}

export function getCctvProviderHealthVersion() {
  return version;
}

export function subscribeCctvProviderHealth(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
