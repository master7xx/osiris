'use client';

import {
  addDebugEvent,
  isDebuggableEndpoint,
  sanitizeEndpoint,
  updateDebugEvent,
  type DebugUpstreamEvent,
} from './debug-events';

declare global {
  interface Window {
    __OSIRIS_DEBUG_FETCH_INSTALLED__?: boolean;
  }
}

const lastStartByEndpoint = new Map<string, number>();

function id(prefix: string) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function installDebugFetch() {
  if (typeof window === 'undefined' || window.__OSIRIS_DEBUG_FETCH_INSTALLED__) return () => {};

  const originalFetch = window.fetch.bind(window);
  window.__OSIRIS_DEBUG_FETCH_INSTALLED__ = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const parsed = new URL(rawUrl, window.location.origin);
    if (parsed.origin !== window.location.origin || !isDebuggableEndpoint(rawUrl)) return originalFetch(input, init);

    const endpoint = sanitizeEndpoint(rawUrl);
    const startedAt = performance.now();
    const previousStart = lastStartByEndpoint.get(endpoint);
    lastStartByEndpoint.set(endpoint, startedAt);

    const eventId = id('req');
    const correlationId = id('corr');
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('x-osiris-request-id', correlationId);

    addDebugEvent({
      id: eventId,
      correlationId,
      endpoint,
      method,
      status: 'pending',
      startedAt: Date.now(),
      gapMs: previousStart === undefined ? undefined : Math.max(0, startedAt - previousStart),
    });

    try {
      const request = input instanceof Request ? new Request(input, { ...init, headers }) : input;
      const response = await originalFetch(request, input instanceof Request ? undefined : { ...init, headers });
      const durationMs = performance.now() - startedAt;
      const resolvedCorrelationId = response.headers.get('x-osiris-request-id') || correlationId;

      updateDebugEvent(eventId, {
        status: response.ok ? 'ok' : 'error',
        httpStatus: response.status,
        finishedAt: Date.now(),
        durationMs,
        serverTiming: response.headers.get('server-timing') || undefined,
        correlationId: resolvedCorrelationId,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`.trim(),
      });

      try {
        const debugResponse = await originalFetch(
          `/api/debug/events?correlationId=${encodeURIComponent(resolvedCorrelationId)}`,
          { cache: 'no-store' },
        );
        if (debugResponse.ok) {
          const payload = await debugResponse.json() as { events?: DebugUpstreamEvent[] };
          if (Array.isArray(payload.events) && payload.events.length) {
            updateDebugEvent(eventId, { upstreams: payload.events });
          }
        }
      } catch {
        // Server instrumentation is optional (disabled in production unless OSIRIS_DEBUG=1).
      }

      return response;
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      updateDebugEvent(eventId, {
        status: aborted ? 'aborted' : 'error',
        finishedAt: Date.now(),
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return () => {
    window.fetch = originalFetch;
    window.__OSIRIS_DEBUG_FETCH_INSTALLED__ = false;
  };
}
