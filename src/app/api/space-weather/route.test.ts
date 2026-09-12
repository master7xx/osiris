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


describe('geomagnetic scale and missing measurements', () => {
  const stubKp = (value: unknown) => vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
    okJson(String(input).endsWith('/json/planetary_k_index_1m.json') ? [{ kp_index: value, time_tag: '2026-09-12T08:00:00Z' }] : [])));

  it.each([
    [0, 'Quiet'], ['0', 'Quiet'], [4, 'Unsettled'], [4.99, 'Unsettled'],
    [5, 'Minor (G1)'], [5.99, 'Minor (G1)'], [6, 'Moderate (G2)'],
    [6.99, 'Moderate (G2)'], [7, 'Strong (G3)'], [7.99, 'Strong (G3)'],
    [8, 'Severe (G4)'], [8.67, 'Severe (G4)'], [9, 'Extreme (G5)'],
  ])('maps Kp %s to %s', async (value, expected) => {
    stubKp(value);
    const body = await (await GET()).json();
    expect(body.storm_level).toBe(expected);
    expect(body.kp_index).toBe(Number(value));
    expect(body.data_status).toBe('available');
  });

  it.each([null, undefined, '', ' ', '4junk', 'NaN', -1, 10, true, {}])('does not manufacture Kp zero from %j', async value => {
    stubKp(value);
    const body = await (await GET()).json();
    expect(body.kp_index).toBeNull();
    expect(body.storm_level).toBe('Unknown');
    expect(body.data_status).toBe('partial');
    expect(body.availability).toEqual({ kp: false, alerts: true, solar_flares: true });
  });

  it('retains alerts and flares when the Kp request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('planetary')) throw new Error('offline');
      if (url.includes('alerts')) return okJson([{ product_id: 'A', issue_datetime: '2026-09-12 08:00:00', message: 'Alert' }]);
      return okJson([{ max_class: 'M1.2' }]);
    }));
    const body = await (await GET()).json();
    expect(body.kp_index).toBeNull();
    expect(body.alerts).toHaveLength(1);
    expect(body.solar_flares).toHaveLength(1);
    expect(body.data_status).toBe('partial');
  });

  it('reports complete upstream outage explicitly on HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data_status).toBe('unavailable');
    expect(body.kp_index).toBeNull();
    expect(body.storm_level).toBe('Unknown');
    expect(body.availability).toEqual({ kp: false, alerts: false, solar_flares: false });
  });
});
