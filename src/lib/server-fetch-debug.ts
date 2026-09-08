import {
  addServerDebugEvent,
  patchServerDebugEvent,
  sanitizeUpstreamUrl,
  serverDebugEnabled,
} from './server-debug-store';

declare global {
  // eslint-disable-next-line no-var
  var __OSIRIS_SERVER_FETCH_INSTALLED__: boolean | undefined;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function currentCorrelationId() {
  try {
    const { headers } = await import('next/headers');
    const incoming = await headers();
    return incoming.get('x-osiris-request-id') || undefined;
  } catch {
    return undefined;
  }
}

export function installServerFetchInstrumentation() {
  if (globalThis.__OSIRIS_SERVER_FETCH_INSTALLED__) return;
  globalThis.__OSIRIS_SERVER_FETCH_INSTALLED__ = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!serverDebugEnabled()) return originalFetch(input, init);

    const rawUrl = input instanceof Request ? input.url : String(input);
    const sanitized = sanitizeUpstreamUrl(rawUrl);

    // Do not record the debug collector itself if a server-side caller uses it.
    if (sanitized.url.includes('/api/debug/events')) return originalFetch(input, init);

    const id = newId();
    const correlationId = await currentCorrelationId();
    const start = performance.now();
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    addServerDebugEvent({
      id,
      correlationId,
      url: sanitized.url,
      host: sanitized.host,
      method,
      startedAt: Date.now(),
      state: 'pending',
    });

    try {
      const response = await originalFetch(input, init);
      patchServerDebugEvent(id, {
        state: response.ok ? 'ok' : 'error',
        status: response.status,
        durationMs: performance.now() - start,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`.trim(),
      });
      return response;
    } catch (error) {
      patchServerDebugEvent(id, {
        state: error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'error',
        durationMs: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
