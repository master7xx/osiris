import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Unavailable',
    json: async () => payload,
  } as Response;
}

const geoPayload = {
  display_name: 'England, United Kingdom',
  address: {
    state: 'England',
    country: 'United Kingdom',
    country_code: 'gb',
  },
};

describe('region dossier resilience', () => {
  it('keeps a useful baseline country profile when Wikipedia and Wikidata time out', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('nominatim.openstreetmap.org/reverse')) return jsonResponse(geoPayload);
      if (url.includes('restcountries.com/v3.1/alpha/GB')) {
        return jsonResponse([{
          name: { common: 'United Kingdom', official: 'United Kingdom of Great Britain and Northern Ireland' },
          capital: ['London'],
          population: 68350000,
          area: 242495,
          region: 'Europe',
          subregion: 'Northern Europe',
          languages: { eng: 'English' },
          currencies: { GBP: { name: 'British pound', symbol: '£' } },
          flags: { svg: 'https://example.test/gb.svg' },
          timezones: ['UTC+00:00'],
          flag: '🇬🇧',
        }]);
      }
      if (url.includes('wikipedia.org') || url.includes('query.wikidata.org')) {
        throw new Error('The operation was aborted due to timeout');
      }
      throw new Error(`unexpected URL ${url}`);
    }));

    const response = await GET(new Request('http://localhost/api/region-dossier?lat=51.5&lng=-0.1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.country).toMatchObject({
      name: 'United Kingdom',
      capital: 'London',
      population: 68350000,
      subregion: 'Northern Europe',
      languages: ['English'],
      currencies: ['British pound'],
      flag: '🇬🇧',
    });
    expect(body.head_of_state).toBeNull();
    expect(body.wikipedia).toBeNull();
    expect(body.partial).toBe(true);
    expect(body.sources.rest_countries.state).toBe('ok');
    expect(body.sources.wikipedia.state).toBe('timeout');
    expect(body.sources.wikidata.state).toBe('timeout');
  });

  it('falls back to Wikidata country fields if the baseline provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('nominatim.openstreetmap.org/reverse')) return jsonResponse(geoPayload);
      if (url.includes('restcountries.com')) return jsonResponse({}, 503);
      if (url.includes('wikipedia.org')) return jsonResponse({ title: 'United Kingdom', extract: 'Summary' });
      if (url.includes('query.wikidata.org')) {
        return jsonResponse({
          results: {
            bindings: [{
              leaderLabel: { value: 'Example Leader' },
              positionLabel: { value: 'Head of State' },
              capitalLabel: { value: 'London' },
              population: { value: '68000000' },
              area: { value: '243610' },
              regionLabel: { value: 'Europe' },
              languages: { value: 'English' },
              currencies: { value: 'pound sterling' },
            }],
          },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    }));

    const response = await GET(new Request('http://localhost/api/region-dossier?lat=52&lng=-1'));
    const body = await response.json();

    expect(body.country).toMatchObject({ capital: 'London', population: 68000000 });
    expect(body.head_of_state).toEqual({ name: 'Example Leader', position: 'Head of State' });
    expect(body.wikipedia.extract).toBe('Summary');
    expect(body.sources.rest_countries.state).toBe('error');
    expect(body.partial).toBe(true);
  });

  it('rejects invalid coordinates without touching upstream services', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/api/region-dossier?lat=999&lng=bad'));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
