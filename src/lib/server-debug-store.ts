export interface ServerDebugFetchEvent {
  id: string;
  correlationId?: string;
  url: string;
  host: string;
  method: string;
  status?: number;
  startedAt: number;
  durationMs?: number;
  state: 'pending' | 'ok' | 'error' | 'aborted';
  error?: string;
}

interface DebugState {
  events: ServerDebugFetchEvent[];
}

const MAX_EVENTS = 1000;
const globalKey = '__OSIRIS_SERVER_DEBUG_STATE__';

function state(): DebugState {
  const root = globalThis as typeof globalThis & { [globalKey]?: DebugState };
  if (!root[globalKey]) root[globalKey] = { events: [] };
  return root[globalKey]!;
}

export function serverDebugEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.OSIRIS_DEBUG === '1';
}

export function sanitizeUpstreamUrl(input: string) {
  try {
    const url = new URL(input);
    return { url: `${url.origin}${url.pathname}`, host: url.host };
  } catch {
    return { url: input.split('?')[0].split('#')[0], host: 'unknown' };
  }
}

export function addServerDebugEvent(event: ServerDebugFetchEvent) {
  const events = state().events;
  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

export function patchServerDebugEvent(id: string, patch: Partial<ServerDebugFetchEvent>) {
  const event = state().events.find(item => item.id === id);
  if (event) Object.assign(event, patch);
}

export function getServerDebugEvents(correlationId?: string) {
  const events = state().events;
  const filtered = correlationId ? events.filter(event => event.correlationId === correlationId) : events;
  return filtered.slice(0, 200).map(event => ({ ...event }));
}

export function clearServerDebugEvents() {
  state().events.length = 0;
}
