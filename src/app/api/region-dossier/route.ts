import { NextResponse } from 'next/server';

/**
 * OSIRIS — Region Dossier API
 * Provides country intelligence for any coordinate (right-click on map).
 * Reverse geocoding identifies the country; baseline country data and optional
 * enrichment then run independently so a slow knowledge source cannot collapse
 * the whole dossier to a single location string.
 */

type SourceState = 'ok' | 'timeout' | 'error' | 'skipped';

interface SourceStatus {
  state: SourceState;
  duration_ms: number;
  error?: string;
}

function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error) return error.message;
  return String(error);
}

async function measured<T>(fn: () => Promise<T>): Promise<{ value: T | null; status: SourceStatus }> {
  const started = performance.now();
  try {
    const value = await fn();
    return { value, status: { state: 'ok', duration_ms: Math.round(performance.now() - started) } };
  } catch (error) {
    const message = errorMessage(error);
    return {
      value: null,
      status: {
        state: /timeout|aborted/i.test(message) ? 'timeout' : 'error',
        duration_ms: Math.round(performance.now() - started),
        error: message,
      },
    };
  }
}

async function fetchJson(url: string, timeoutMs: number, headers?: HeadersInit) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return response.json();
}

function countryFromRest(raw: any, fallbackName: string) {
  if (!raw) return null;
  const languages = raw.languages && typeof raw.languages === 'object'
    ? Object.values(raw.languages).map(String)
    : [];
  const currencies = raw.currencies && typeof raw.currencies === 'object'
    ? Object.values(raw.currencies).map((entry: any) => entry?.name || entry?.symbol).filter(Boolean)
    : [];

  return {
    name: raw.name?.common || fallbackName,
    official_name: raw.name?.official || raw.name?.common || fallbackName,
    capital: Array.isArray(raw.capital) ? raw.capital[0] : raw.capital,
    population: Number.isFinite(raw.population) ? raw.population : undefined,
    area: Number.isFinite(raw.area) ? raw.area : undefined,
    region: raw.region || undefined,
    subregion: raw.subregion || raw.region || undefined,
    languages,
    currencies,
    flag: raw.flag || undefined,
    flag_url: raw.flags?.svg || raw.flags?.png,
    timezones: Array.isArray(raw.timezones) ? raw.timezones : [],
  };
}

function countryFromWikidata(wdData: any, countryName: string) {
  if (!wdData) return null;
  return {
    name: countryName,
    official_name: countryName,
    capital: wdData.capitalLabel?.value,
    population: wdData.population?.value ? parseInt(wdData.population.value, 10) : undefined,
    area: wdData.area?.value ? parseFloat(wdData.area.value) : undefined,
    region: wdData.regionLabel?.value,
    subregion: wdData.regionLabel?.value,
    languages: wdData.languages?.value ? wdData.languages.value.split(', ') : [],
    currencies: wdData.currencies?.value ? wdData.currencies.value.split(', ') : [],
    flag_url: wdData.flagUrl?.value,
    timezones: [],
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
  }

  try {
    const geo = await measured(async () => fetchJson(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=5&addressdetails=1`,
      8000,
      { 'User-Agent': 'OsirisIntelPlatform/1.0' },
    ));

    if (!geo.value) {
      return NextResponse.json({
        coordinates: { lat, lng },
        location: {},
        country: null,
        head_of_state: null,
        wikipedia: null,
        partial: true,
        sources: { nominatim: geo.status },
        error: 'Reverse geocoding unavailable',
        timestamp: new Date().toISOString(),
      }, { status: 200, headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } });
    }

    const geoData = geo.value as any;
    const addr = geoData.address || {};
    const countryName = addr.country || '';
    const countryCode = addr.country_code?.toUpperCase() || '';
    const locationInfo = {
      city: addr.city || addr.town || addr.village || '',
      state: addr.state || addr.region || '',
      country: countryName,
      country_code: countryCode,
      display_name: geoData.display_name,
    };

    const baselinePromise = countryCode
      ? measured(async () => {
          const payload = await fetchJson(
            `https://restcountries.com/v3.1/alpha/${encodeURIComponent(countryCode)}?fields=name,capital,population,area,region,subregion,languages,currencies,flags,timezones,flag`,
            5000,
            { 'User-Agent': 'OsirisIntelPlatform/1.0' },
          );
          const row = Array.isArray(payload) ? payload[0] : payload;
          return countryFromRest(row, countryName);
        })
      : Promise.resolve({ value: null, status: { state: 'skipped', duration_ms: 0 } as SourceStatus });

    const wikipediaPromise = (locationInfo.city || countryName)
      ? measured(async () => {
          const wikiQuery = locationInfo.city || countryName;
          const wiki = await fetchJson(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiQuery)}`,
            5000,
          );
          return {
            title: wiki.title,
            extract: wiki.extract?.substring(0, 500),
            thumbnail: wiki.thumbnail?.source,
          };
        })
      : Promise.resolve({ value: null, status: { state: 'skipped', duration_ms: 0 } as SourceStatus });

    const wikidataPromise = countryName
      ? measured(async () => {
          const safe = countryName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const sparql = `
          SELECT ?leaderLabel ?positionLabel ?population ?area ?capitalLabel ?regionLabel ?flagUrl (GROUP_CONCAT(DISTINCT ?langLabel; separator=", ") AS ?languages) (GROUP_CONCAT(DISTINCT ?currLabel; separator=", ") AS ?currencies)
          WHERE {
            ?country wdt:P31/wdt:P279* wd:Q6256;
                     rdfs:label "${safe}"@en.
            OPTIONAL {
              ?country wdt:P6 ?leader.
              OPTIONAL { ?leader wdt:P39 ?position. }
            }
            OPTIONAL { ?country wdt:P1082 ?population. }
            OPTIONAL { ?country wdt:P2046 ?area. }
            OPTIONAL { ?country wdt:P36 ?capital. }
            OPTIONAL { ?country wdt:P30 ?region. }
            OPTIONAL { ?country wdt:P37 ?lang. }
            OPTIONAL { ?country wdt:P38 ?curr. }
            OPTIONAL { ?country wdt:P41 ?flagUrl. }
            SERVICE wikibase:label {
              bd:serviceParam wikibase:language "en".
              ?leader rdfs:label ?leaderLabel.
              ?position rdfs:label ?positionLabel.
              ?capital rdfs:label ?capitalLabel.
              ?region rdfs:label ?regionLabel.
              ?lang rdfs:label ?langLabel.
              ?curr rdfs:label ?currLabel.
            }
          }
          GROUP BY ?leaderLabel ?positionLabel ?population ?area ?capitalLabel ?regionLabel ?flagUrl
          LIMIT 1`;
          const wd = await fetchJson(
            `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
            6000,
            { 'User-Agent': 'OsirisIntelPlatform/1.0', Accept: 'application/json' },
          );
          return wd.results?.bindings?.[0] || null;
        })
      : Promise.resolve({ value: null, status: { state: 'skipped', duration_ms: 0 } as SourceStatus });

    const [baseline, wikipedia, wikidata] = await Promise.all([
      baselinePromise,
      wikipediaPromise,
      wikidataPromise,
    ]);

    const wdCountry = countryFromWikidata(wikidata.value, countryName);
    const countryData = baseline.value || wdCountry;
    if (countryData && wdCountry) {
      countryData.capital ||= wdCountry.capital;
      countryData.population ||= wdCountry.population;
      countryData.area ||= wdCountry.area;
      countryData.region ||= wdCountry.region;
      countryData.subregion ||= wdCountry.subregion;
      if (!countryData.languages?.length) countryData.languages = wdCountry.languages;
      if (!countryData.currencies?.length) countryData.currencies = wdCountry.currencies;
      countryData.flag_url ||= wdCountry.flag_url;
    }

    const headOfState = wikidata.value?.leaderLabel ? {
      name: wikidata.value.leaderLabel.value,
      position: wikidata.value.positionLabel?.value || 'Head of State',
    } : null;

    const sources = {
      nominatim: geo.status,
      rest_countries: baseline.status,
      wikipedia: wikipedia.status,
      wikidata: wikidata.status,
    };
    const partial = Object.values(sources).some(status => status.state !== 'ok');

    return NextResponse.json({
      coordinates: { lat, lng },
      location: locationInfo,
      country: countryData,
      head_of_state: headOfState,
      wikipedia: wikipedia.value,
      partial,
      sources,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    console.error('Region dossier error:', error);
    return NextResponse.json({ error: 'Failed to fetch region data' }, { status: 500 });
  }
}
