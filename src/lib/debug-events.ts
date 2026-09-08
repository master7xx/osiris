export type DebugRequestStatus = 'pending' | 'ok' | 'error' | 'aborted';

export interface DebugUpstreamEvent {
  id: string;
  url: string;
  host: string;
  method: string;
  status?: number;
  startedAt: number;
  durationMs?: number;
  state: DebugRequestStatus;
  error?: string;
}

export interface DebugRequestEvent {
  id: string;
  correlationId: string;
  endpoint: string;
  method: string;
  status: DebugRequestStatus;
  httpStatus?: number;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  gapMs?: number;
  serverTiming?: string;
  error?: string;
  upstreams?: DebugUpstreamEvent[];
}

const MAX_EVENTS = 300;
const events: DebugRequestEvent[] = [];
const listeners = new Set<() => void>();
let version = 0;

export function sanitizeEndpoint(input: string): string {
  try {
    const url = new URL(input, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    return url.pathname;
  } catch {
    return input.split('?')[0].split('#')[0];
  }
}

export function isDebuggableEndpoint(input: string): boolean {
  const endpoint = sanitizeEndpoint(input);
  return endpoint === '/api' || (endpoint.startsWith('/api/') && endpoint !== '/api/debug/events');
}

export function addDebugEvent(event: DebugRequestEvent) {
  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  version += 1;
  listeners.forEach(listener => listener());
}

export function updateDebugEvent(id: string, patch: Partial<DebugRequestEvent>) {
  const event = events.find(item => item.id === id);
  if (!event) return;
  Object.assign(event, patch);
  version += 1;
  listeners.forEach(listener => listener());
}

export function clearDebugEvents() {
  events.length = 0;
  version += 1;
  listeners.forEach(listener => listener());
}

export function getDebugEventsSnapshot(): DebugRequestEvent[] {
  return events.map(event => ({
    ...event,
    upstreams: event.upstreams?.map(upstream => ({ ...upstream })),
  }));
}

export function getDebugEventsVersion() {
  return version;
}

export function subscribeDebugEvents(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
