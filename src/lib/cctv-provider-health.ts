export type CctvProviderId = 'opencctv' | 'windy' | 'official' | 'curated';
export type CctvProviderKind = 'aggregator' | 'official' | 'curated';
export type CctvProviderState = 'idle' | 'healthy' | 'partial' | 'error' | 'disabled';

export interface CctvProviderScopeSnapshot {
  scope: string;
  state: CctvProviderState;
  enabled: boolean;
  cameras: number;
  duration_ms?: number;
  last_attempt_at?: string;
  last_success_at?: string;
  last_error?: string;
}

export interface CctvProviderHealthSnapshot {
  id: CctvProviderId;
  label: string;
  kind: CctvProviderKind;
  state: CctvProviderState;
  enabled: boolean;
  cameras: number;
  response_cameras: number;
  duration_ms?: number;
  last_attempt_at?: string;
  last_success_at?: string;
  last_error?: string;
  scopes: CctvProviderScopeSnapshot[];
}

interface ScopeRecord {
  state: CctvProviderState;
  enabled: boolean;
  cameras: number;
  durationMs?: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
}

interface ProviderRecord {
  scopes: Record<string, ScopeRecord>;
  responseCameras: number;
  responseAt?: number;
  lastResponseSuccessAt?: number;
}

interface RuntimeState {
  providers: Record<CctvProviderId, ProviderRecord>;
}

declare global {
  // eslint-disable-next-line no-var
  var __OSIRIS_CCTV_PROVIDER_HEALTH__: RuntimeState | undefined;
}

const DEFINITIONS: Record<CctvProviderId, { label: string; kind: CctvProviderKind; enabled: boolean }> = {
  opencctv: { label: 'OpenCCTV', kind: 'aggregator', enabled: true },
  windy: { label: 'Windy', kind: 'aggregator', enabled: false },
  official: { label: 'Official', kind: 'official', enabled: true },
  curated: { label: 'Curated', kind: 'curated', enabled: true },
};

function providerEnabledByConfig(id: CctvProviderId) {
  if (id === 'windy') return Boolean(process.env.WINDY_WEBCAMS_API_KEY?.trim());
  return DEFINITIONS[id].enabled;
}

function emptyRecord(): ProviderRecord {
  return { scopes: {}, responseCameras: 0 };
}

function root(): RuntimeState {
  if (!globalThis.__OSIRIS_CCTV_PROVIDER_HEALTH__) {
    globalThis.__OSIRIS_CCTV_PROVIDER_HEALTH__ = {
      providers: {
        opencctv: emptyRecord(),
        windy: emptyRecord(),
        official: emptyRecord(),
        curated: emptyRecord(),
      },
    };
  }
  return globalThis.__OSIRIS_CCTV_PROVIDER_HEALTH__;
}

export function noteCctvProviderScope(
  id: CctvProviderId,
  scope: string,
  input: {
    state: CctvProviderState;
    enabled?: boolean;
    cameras?: number;
    durationMs?: number;
    error?: string;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();
  const provider = root().providers[id];
  const enabled = input.enabled ?? providerEnabledByConfig(id);
  const cameras = Math.max(0, Math.round(input.cameras ?? 0));
  const previous = provider.scopes[scope];

  provider.scopes[scope] = {
    state: input.state,
    enabled,
    cameras,
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : previous?.durationMs,
    lastAttemptAt: now,
    lastSuccessAt: input.state === 'healthy' || input.state === 'partial'
      ? now
      : previous?.lastSuccessAt,
    lastError: input.error || (input.state === 'healthy' ? undefined : previous?.lastError),
  };
}

export function noteCctvProviderResponse(cameras: Array<{ id?: string; source?: string }>, now = Date.now()) {
  const counts: Record<CctvProviderId, number> = {
    opencctv: 0,
    windy: 0,
    official: 0,
    curated: 0,
  };

  for (const camera of cameras) counts[classifyCctvProvider(camera)] += 1;

  const state = root();
  for (const id of Object.keys(counts) as CctvProviderId[]) {
    const provider = state.providers[id];
    provider.responseCameras = counts[id];
    provider.responseAt = now;
    if (counts[id] > 0) provider.lastResponseSuccessAt = now;
  }
}

export function classifyCctvProvider(camera: { id?: string; source?: string }): CctvProviderId {
  const source = camera.source?.trim() || '';
  const id = camera.id?.trim() || '';

  if (/^OpenCCTV(?:\s|\/|$)/i.test(source) || id.startsWith('occ-')) return 'opencctv';
  if (/Windy\.com/i.test(source) || id.startsWith('windy-')) return 'windy';
  if (
    id.startsWith('sky-')
    || /SkylineWebcams/i.test(source)
    || /YouTube Live/i.test(source)
    || /curated/i.test(source)
  ) return 'curated';

  return 'official';
}

function aggregateState(
  scopes: ScopeRecord[],
  responseCameras: number,
  defaultEnabled: boolean,
): CctvProviderState {
  if (!scopes.length) {
    if (!defaultEnabled) return 'disabled';
    return responseCameras > 0 ? 'healthy' : 'idle';
  }

  const enabled = scopes.filter(scope => scope.enabled && scope.state !== 'disabled');
  if (!enabled.length) return scopes.some(scope => scope.state === 'disabled') ? 'disabled' : 'idle';

  const errors = enabled.filter(scope => scope.state === 'error').length;
  const partials = enabled.filter(scope => scope.state === 'partial').length;
  const healthy = enabled.filter(scope => scope.state === 'healthy').length;

  if (errors === enabled.length) return 'error';
  if (errors > 0 || partials > 0) return 'partial';
  if (healthy > 0) return 'healthy';
  return responseCameras > 0 ? 'healthy' : 'idle';
}

function iso(value?: number) {
  return value ? new Date(value).toISOString() : undefined;
}

export function getCctvProviderHealth(): CctvProviderHealthSnapshot[] {
  const runtime = root();

  return (Object.keys(DEFINITIONS) as CctvProviderId[]).map(id => {
    const definition = DEFINITIONS[id];
    const provider = runtime.providers[id];
    const defaultEnabled = providerEnabledByConfig(id);
    const entries = Object.entries(provider.scopes);
    const scopes = entries.map(([scope, record]): CctvProviderScopeSnapshot => ({
      scope,
      state: record.state,
      enabled: record.enabled,
      cameras: record.cameras,
      duration_ms: record.durationMs === undefined ? undefined : Math.round(record.durationMs),
      last_attempt_at: iso(record.lastAttemptAt),
      last_success_at: iso(record.lastSuccessAt),
      last_error: record.lastError,
    }));

    const records = entries.map(([, record]) => record);
    const enabled = records.length
      ? records.some(record => record.enabled && record.state !== 'disabled')
      : defaultEnabled;
    const latestAttempt = Math.max(0, ...records.map(record => record.lastAttemptAt ?? 0), provider.responseAt ?? 0);
    const latestSuccess = Math.max(
      0,
      ...records.map(record => record.lastSuccessAt ?? 0),
      provider.lastResponseSuccessAt ?? 0,
    );
    const duration = records.length ? Math.max(...records.map(record => record.durationMs ?? 0)) : undefined;
    const latestError = records
      .filter(record => record.lastError)
      .sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))[0]?.lastError;

    return {
      id,
      label: definition.label,
      kind: definition.kind,
      state: aggregateState(records, provider.responseCameras, defaultEnabled),
      enabled,
      cameras: records.reduce((sum, record) => sum + record.cameras, 0),
      response_cameras: provider.responseCameras,
      duration_ms: duration === undefined ? undefined : Math.round(duration),
      last_attempt_at: latestAttempt ? iso(latestAttempt) : undefined,
      last_success_at: latestSuccess ? iso(latestSuccess) : undefined,
      last_error: latestError,
      scopes: scopes.sort((a, b) => a.scope.localeCompare(b.scope)),
    };
  });
}

export function resetCctvProviderHealthForTests() {
  globalThis.__OSIRIS_CCTV_PROVIDER_HEALTH__ = undefined;
}
