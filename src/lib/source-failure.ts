export type SourceFailureKind = 'timeout' | 'http' | 'network' | 'invalid_response' | 'cancelled' | 'unknown';
export interface SourceFailureInfo { kind: SourceFailureKind; http_status?: number; retry_at?: string }
export class SourceRequestError extends Error {
  constructor(readonly failure: SourceFailureInfo) { super(failure.http_status ? `Source HTTP ${failure.http_status}` : `Source ${failure.kind}`); }
}
export function sourceFailure(error: unknown): SourceFailureInfo {
  if (error instanceof SourceRequestError) return { ...error.failure };
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return { kind: 'timeout' };
    if (error.name === 'AbortError') return { kind: 'cancelled' };
    if (error instanceof SyntaxError) return { kind: 'invalid_response' };
    const status = /\bHTTP ([45][0-9]{2})\b/.exec(error.message);
    if (status) return { kind: 'http', http_status: Number(status[1]) };
    const code = (error.cause as { code?: string } | undefined)?.code;
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code || '')) return { kind: 'timeout' };
    if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code || '') || error.message === 'fetch failed') return { kind: 'network' };
  }
  return { kind: 'unknown' };
}
/** Only typed, bounded metadata crosses into downloaded reports. */
export function publicSourceFailure(value?: SourceFailureInfo) {
  if (!value || !['timeout', 'http', 'network', 'invalid_response', 'cancelled', 'unknown'].includes(value.kind)) return null;
  return { kind: value.kind,
    ...(Number.isInteger(value.http_status) && value.http_status! >= 400 && value.http_status! <= 599 ? { httpStatus: value.http_status } : {}),
    ...(typeof value.retry_at === 'string' && Number.isFinite(Date.parse(value.retry_at)) ? { retryAt: new Date(value.retry_at).toISOString() } : {}),
  };
}
