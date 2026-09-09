import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());

function okJson(payload: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => payload };
}

describe('space weather route', () => {
  it('uses the current NOAA products endpoint for alerts', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/json/planetary_k_index_1m.json')) {
        return okJson([{ kp_index: '4', time_tag: '2026-09-09T08:00:00Z' }]);
      }
      if (url.endsWith('/products/alerts.json')) {
        return okJson([{ product_id: 'ALTK04-test', issue_datetime: '2026 Sep 09 0800 UTC', message: 'Test alert' }]);
      }
      if (url.endsWith('/json/goes/primary/xray-flares-latest.json')) {
        return okJson([{ max_class: 'M1.2', begin_time: 'a', max_time: 'b', end_time: 'c' }]);
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toContain(
      'https://services.swpc.noaa.gov/products/alerts.json',
    );
    expect(body.alerts[0]).toMatchObject({ id: 'ALTK04-test', message: 'Test alert' });
    expect(body.kp_index).toBe(4);
    expect(body.solar_flares[0].class).toBe('M1.2');
  });

  it('keeps partial space-weather data when the alerts source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/products/alerts.json')) {
        return { ok: false, status: 503, statusText: 'Unavailable', json: async () => ({}) };
      }
      if (url.endsWith('/json/planetary_k_index_1m.json')) {
        return okJson([{ kp_index: '2', time_tag: '2026-09-09T08:00:00Z' }]);
      }
      return okJson([]);
    }));

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.kp_index).toBe(2);
    expect(body.alerts).toEqual([]);
  });
});
