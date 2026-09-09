import { classifyCctvProvider, type CctvProviderId } from './cctv-provider-health';

export type CctvCoverageBand = 'gap' | 'sparse' | 'covered' | 'dense';
export type CctvFeedKind = 'snapshot' | 'hls' | 'iframe' | 'mjpeg' | 'video' | 'external' | 'unknown';
export type CctvMacroRegionId =
  | 'north-america'
  | 'europe'
  | 'russia-eurasia'
  | 'east-asia'
  | 'southeast-asia'
  | 'south-asia'
  | 'middle-east'
  | 'africa'
  | 'latam-caribbean'
  | 'oceania'
  | 'other';

export interface CctvCoverageCamera {
  id?: string;
  lat?: number;
  lng?: number;
  country?: string;
  source?: string;
  feed_url?: string;
  stream_url?: string;
  stream_type?: string;
  external_url?: string;
}

export interface CctvCountryCoverage {
  country: string;
  cameras: number;
}

export interface CctvMacroCoverage {
  id: CctvMacroRegionId;
  label: string;
  band: CctvCoverageBand;
  cameras: number;
  countries_seen: number;
  countries: CctvCountryCoverage[];
  provider_counts: Record<CctvProviderId, number>;
  feed_counts: Record<CctvFeedKind, number>;
  suspected_duplicates: number;
  watchlist_total: number;
  watchlist_seen: number;
  watchlist_missing: string[];
  watchlist_weak: string[];
  gap_score: number;
}

export interface CctvCoverageSnapshot {
  scope: 'global' | 'request';
  total_cameras: number;
  countries_seen: number;
  unknown_country_cameras: number;
  suspected_duplicates: number;
  request_regions: string[];
  priority_regions: CctvMacroRegionId[];
  generated_at: string;
  regions: CctvMacroCoverage[];
}

declare global {
  // eslint-disable-next-line no-var
  var __OSIRIS_CCTV_GLOBAL_COVERAGE__: CctvCoverageSnapshot | undefined;
}

const REGION_LABELS: Record<CctvMacroRegionId, string> = {
  'north-america': 'North America',
  europe: 'Europe',
  'russia-eurasia': 'Russia / Eurasia',
  'east-asia': 'East Asia',
  'southeast-asia': 'Southeast Asia',
  'south-asia': 'South Asia',
  'middle-east': 'Middle East',
  africa: 'Africa',
  'latam-caribbean': 'LatAm / Caribbean',
  oceania: 'Oceania',
  other: 'Other / Unclassified',
};

const REGION_ORDER: CctvMacroRegionId[] = [
  'north-america',
  'europe',
  'russia-eurasia',
  'east-asia',
  'southeast-asia',
  'south-asia',
  'middle-east',
  'africa',
  'latam-caribbean',
  'oceania',
  'other',
];

/**
 * Strategic country watchlists, not a claim of exhaustive political geography.
 * They exist to answer a practical integration question: which globally useful
 * areas are still missing or represented by only a handful of cameras?
 */
const WATCHLISTS: Record<CctvMacroRegionId, string[]> = {
  'north-america': ['United States', 'Canada', 'Mexico'],
  europe: [
    'United Kingdom', 'France', 'Germany', 'Spain', 'Italy', 'Netherlands',
    'Poland', 'Ukraine', 'Finland', 'Sweden', 'Norway', 'Romania', 'Greece',
  ],
  'russia-eurasia': [
    'Russia', 'Kazakhstan', 'Belarus', 'Georgia', 'Armenia', 'Azerbaijan',
    'Uzbekistan', 'Kyrgyzstan',
  ],
  'east-asia': ['Japan', 'South Korea', 'China', 'Taiwan', 'Hong Kong', 'Mongolia'],
  'southeast-asia': ['Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Malaysia', 'Singapore'],
  'south-asia': ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal'],
  'middle-east': ['Turkey', 'Israel', 'Iran', 'Saudi Arabia', 'United Arab Emirates', 'Iraq', 'Jordan'],
  africa: ['South Africa', 'Egypt', 'Morocco', 'Algeria', 'Tunisia', 'Nigeria', 'Kenya', 'Ethiopia', 'Ghana', 'Tanzania'],
  'latam-caribbean': ['Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Venezuela', 'Ecuador', 'Uruguay'],
  oceania: ['Australia', 'New Zealand', 'Papua New Guinea', 'Fiji'],
  other: [],
};

const ALIASES: Record<string, string> = {
  us: 'United States',
  usa: 'United States',
  'united states of america': 'United States',
  uk: 'United Kingdom',
  gb: 'United Kingdom',
  'great britain': 'United Kingdom',
  'russian federation': 'Russia',
  ru: 'Russia',
  jp: 'Japan',
  'republic of korea': 'South Korea',
  korea: 'South Korea',
  'korea, republic of': 'South Korea',
  kr: 'South Korea',
  cn: 'China',
  tw: 'Taiwan',
  hk: 'Hong Kong',
  uae: 'United Arab Emirates',
  'u.a.e.': 'United Arab Emirates',
  nz: 'New Zealand',
  au: 'Australia',
  deutschland: 'Germany',
  españa: 'Spain',
  espana: 'Spain',
  'czech republic': 'Czechia',
};

const COUNTRY_REGION = new Map<string, CctvMacroRegionId>();
for (const region of REGION_ORDER) {
  for (const country of WATCHLISTS[region]) COUNTRY_REGION.set(country, region);
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeCctvCountry(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const alias = ALIASES[normalizeKey(raw)];
  if (alias) return alias;
  return raw
    .split(/\s+/)
    .map(part => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part)
    .join(' ');
}

function inside(lat: number, lng: number, minLat: number, maxLat: number, minLng: number, maxLng: number) {
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

export function classifyCctvMacroRegion(camera: CctvCoverageCamera): CctvMacroRegionId {
  const country = normalizeCctvCountry(camera.country);
  const mapped = country ? COUNTRY_REGION.get(country) : undefined;
  if (mapped) return mapped;

  const lat = camera.lat;
  const lng = camera.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'other';

  // Order matters where continental boxes overlap. Specific Asian belts first.
  if (inside(lat, lng, 18, 50, 90, 150)) return 'east-asia';
  if (inside(lat, lng, -12, 25, 92, 141)) return 'southeast-asia';
  if (inside(lat, lng, 5, 37, 60, 92)) return 'south-asia';
  if (inside(lat, lng, 46, 82, 30, 180)) return 'russia-eurasia';
  if (inside(lat, lng, 35, 72, -25, 40)) return 'europe';
  if (inside(lat, lng, 12, 42, 25, 60)) return 'middle-east';
  if (inside(lat, lng, -36, 38, -26, 60)) return 'africa';
  if (inside(lat, lng, -57, 23.5, -120, -30)) return 'latam-caribbean';
  if (inside(lat, lng, -50, 5, 110, 180)) return 'oceania';
  if (inside(lat, lng, 23.5, 85, -170, -50)) return 'north-america';
  return 'other';
}

export function classifyCctvFeed(camera: CctvCoverageCamera): CctvFeedKind {
  const stream = camera.stream_type?.trim().toLowerCase();
  if (stream === 'hls') return 'hls';
  if (stream === 'iframe') return 'iframe';
  if (stream === 'mjpeg') return 'mjpeg';
  if (stream && stream !== 'jpg') return 'video';
  if (camera.feed_url) return 'snapshot';
  if (camera.stream_url) return 'video';
  if (camera.external_url) return 'external';
  return 'unknown';
}

function emptyProviderCounts(): Record<CctvProviderId, number> {
  return { opencctv: 0, windy: 0, official: 0, curated: 0 };
}

function emptyFeedCounts(): Record<CctvFeedKind, number> {
  return { snapshot: 0, hls: 0, iframe: 0, mjpeg: 0, video: 0, external: 0, unknown: 0 };
}

function duplicateCount(cameras: CctvCoverageCamera[]) {
  const cells = new Map<string, CctvCoverageCamera[]>();
  for (const camera of cameras) {
    const lat = camera.lat;
    const lng = camera.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // ~100 m at mid-latitudes: conservative enough for "suspected", not a hard dedupe.
    const key = `${lat.toFixed(3)}:${lng.toFixed(3)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(camera);
    else cells.set(key, [camera]);
  }

  let duplicates = 0;
  for (const bucket of cells.values()) {
    if (bucket.length < 2) continue;
    const providers = new Set(bucket.map(camera => classifyCctvProvider(camera)));
    const sources = new Set(bucket.map(camera => camera.source?.trim()).filter(Boolean));
    if (providers.size > 1 || sources.size > 1) duplicates += bucket.length - 1;
  }
  return duplicates;
}

function coverageBand(cameras: number): CctvCoverageBand {
  if (cameras === 0) return 'gap';
  if (cameras < 10) return 'sparse';
  if (cameras < 100) return 'covered';
  return 'dense';
}

function gapScore(cameras: number, watchlist: string[], missing: string[], weak: string[]) {
  if (!watchlist.length) return cameras === 0 ? 100 : cameras < 10 ? 60 : 0;
  const densityPenalty = cameras === 0 ? 40 : cameras < 10 ? 30 : cameras < 50 ? 15 : cameras < 100 ? 5 : 0;
  const missingPenalty = (missing.length / watchlist.length) * 50;
  const weakPenalty = (weak.length / watchlist.length) * 10;
  return Math.min(100, Math.round(densityPenalty + missingPenalty + weakPenalty));
}

export function analyzeCctvCoverage(
  cameras: CctvCoverageCamera[],
  options: { scope?: 'global' | 'request'; requestRegions?: string[]; now?: number } = {},
): CctvCoverageSnapshot {
  const grouped = new Map<CctvMacroRegionId, CctvCoverageCamera[]>();
  for (const region of REGION_ORDER) grouped.set(region, []);

  const countries = new Set<string>();
  let unknownCountry = 0;
  for (const camera of cameras) {
    const region = classifyCctvMacroRegion(camera);
    grouped.get(region)?.push(camera);
    const country = normalizeCctvCountry(camera.country);
    if (country) countries.add(country);
    else unknownCountry += 1;
  }

  const regions = REGION_ORDER.map((id): CctvMacroCoverage => {
    const rows = grouped.get(id) ?? [];
    const providerCounts = emptyProviderCounts();
    const feedCounts = emptyFeedCounts();
    const countryCounts = new Map<string, number>();

    for (const camera of rows) {
      providerCounts[classifyCctvProvider(camera)] += 1;
      feedCounts[classifyCctvFeed(camera)] += 1;
      const country = normalizeCctvCountry(camera.country);
      if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }

    const watchlist = WATCHLISTS[id];
    const missing = watchlist.filter(country => !countryCounts.has(country));
    const weak = watchlist.filter(country => {
      const count = countryCounts.get(country) ?? 0;
      return count > 0 && count < 5;
    });

    return {
      id,
      label: REGION_LABELS[id],
      band: coverageBand(rows.length),
      cameras: rows.length,
      countries_seen: countryCounts.size,
      countries: [...countryCounts.entries()]
        .map(([country, count]) => ({ country, cameras: count }))
        .sort((a, b) => b.cameras - a.cameras || a.country.localeCompare(b.country)),
      provider_counts: providerCounts,
      feed_counts: feedCounts,
      suspected_duplicates: duplicateCount(rows),
      watchlist_total: watchlist.length,
      watchlist_seen: watchlist.length - missing.length,
      watchlist_missing: missing,
      watchlist_weak: weak,
      gap_score: gapScore(rows.length, watchlist, missing, weak),
    };
  });

  const priority = regions
    .filter(region => region.id !== 'other' && region.gap_score > 0)
    .sort((a, b) => b.gap_score - a.gap_score || a.cameras - b.cameras)
    .slice(0, 5)
    .map(region => region.id);

  return {
    scope: options.scope ?? 'request',
    total_cameras: cameras.length,
    countries_seen: countries.size,
    unknown_country_cameras: unknownCountry,
    suspected_duplicates: duplicateCount(cameras),
    request_regions: [...(options.requestRegions ?? [])],
    priority_regions: priority,
    generated_at: new Date(options.now ?? Date.now()).toISOString(),
    regions,
  };
}

export function noteGlobalCctvCoverage(snapshot: CctvCoverageSnapshot) {
  if (snapshot.scope !== 'global') return;
  globalThis.__OSIRIS_CCTV_GLOBAL_COVERAGE__ = structuredClone(snapshot);
}

export function getGlobalCctvCoverage() {
  return globalThis.__OSIRIS_CCTV_GLOBAL_COVERAGE__
    ? structuredClone(globalThis.__OSIRIS_CCTV_GLOBAL_COVERAGE__)
    : undefined;
}

export function resetCctvCoverageForTests() {
  globalThis.__OSIRIS_CCTV_GLOBAL_COVERAGE__ = undefined;
}
