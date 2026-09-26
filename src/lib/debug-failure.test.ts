import { expect, it } from 'vitest';
import { isDebugFailure, type DebugRequestEvent } from './debug-events';
it('keeps cancelled client requests out of errors without hiding failures or upstream timeouts', () => {
  const event: DebugRequestEvent = { id: '1', correlationId: '1', endpoint: '/api/cctv/resolve', method: 'GET', startedAt: 0, status: 'aborted' };
  expect(isDebugFailure(event)).toBe(false);
  expect(isDebugFailure({ ...event, status: 'error', httpStatus: 502 })).toBe(true);
  expect(isDebugFailure({ ...event, status: 'ok', upstreams: [{ id: 'u', url: 'https://x', host: 'x', method: 'GET', startedAt: 0, state: 'aborted' }] })).toBe(true);
});
