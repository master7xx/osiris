import { SourceRequestError, sourceFailure, type SourceFailureInfo } from './source-failure';

interface DiscoveryResult { articles: unknown[]; failure?: SourceFailureInfo; completed: number }
/** One sequential batch per process; failures defer work to a later collector cycle. */
export function createGdeltDiscovery(queries: string[], fetcher: typeof fetch = (...args) => fetch(...args), now = Date.now,
  wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  let inFlight: Promise<DiscoveryResult> | undefined;
  let nextStart = 0;
  let retryAt = 0;
  let failures = 0;
  let startIndex = 0;
  let lastFailure: SourceFailureInfo | undefined;
  async function run(): Promise<DiscoveryResult> {
    if (now() < retryAt) throw new SourceRequestError({ ...lastFailure!, retry_at: new Date(retryAt).toISOString() });
    const articles: unknown[] = [];
    let completed = 0;
    for (let offset = 0; offset < queries.length; offset++) {
      const index = (startIndex + offset) % queries.length;
      const pause = nextStart - now();
      if (pause > 0) await wait(pause);
      nextStart = now() + 5000;
      let providerRetryAt = 0;
      const deadline = AbortSignal.timeout(10000);
      try {
        const params = new URLSearchParams({ query: queries[index], mode: 'ArtList', maxrecords: '50', format: 'json', sort: 'datedesc', timespan: '3h' });
        const response = await fetcher(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
          signal: deadline, headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS/1.0' }, cache: 'no-store',
        });
        if (!response.ok) {
          const retry = response.headers.get('retry-after');
          if (retry && [429, 503].includes(response.status)) {
            const seconds = /^\d+$/.test(retry.trim()) ? Number(retry) : NaN;
            providerRetryAt = Number.isFinite(seconds) ? now() + seconds * 1000 : Date.parse(retry);
            if (!Number.isFinite(providerRetryAt) || providerRetryAt > 8640000000000000) providerRetryAt = 0;
          }
          await response.body?.cancel().catch(() => {});
          throw new SourceRequestError({ kind: 'http', http_status: response.status });
        }
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.articles)) throw new SourceRequestError({ kind: 'invalid_response' });
        articles.push(...payload.articles);
        completed++;
      } catch (error) {
        failures++;
        retryAt = Math.max(now() + Math.min(90000 * 2 ** Math.min(failures - 1, 4), 900000), providerRetryAt);
        lastFailure = { ...sourceFailure(deadline.aborted ? deadline.reason : error), retry_at: new Date(retryAt).toISOString() };
        // Rotate after an outage so one failing topic cannot starve the others.
        startIndex = (index + 1) % queries.length;
        if (!completed) throw new SourceRequestError(lastFailure);
        return { articles, completed, failure: lastFailure };
      }
    }
    failures = 0; retryAt = 0; lastFailure = undefined;
    return { articles, completed };
  }
  return () => {
    if (!inFlight) inFlight = run().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
