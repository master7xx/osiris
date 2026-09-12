'use client';

export type ClientCctvCoverageBand = 'gap' | 'sparse' | 'covered' | 'dense';
export type ClientCctvPriorityTier = 1 | 2 | 3;
export type ClientCctvPriorityStatus = 'missing' | 'weak' | 'covered';
export type ClientCctvMacroRegionId =
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

export interface ClientCctvMacroCoverage {
  id: ClientCctvMacroRegionId;
  label: string;
  band: ClientCctvCoverageBand;
  cameras: number;
  countries_seen: number;
  countries: Array<{ country: string; cameras: number }>;
  provider_counts: Record<'opencctv' | 'windy' | 'official' | 'curated', number>;
  feed_counts: Record<'snapshot' | 'hls' | 'iframe' | 'mjpeg' | 'video' | 'external' | 'unknown', number>;
  suspected_duplicates: number;
  watchlist_total: number;
  watchlist_seen: number;
  watchlist_missing: string[];
  watchlist_weak: string[];
  priority_tier?: ClientCctvPriorityTier;
  gap_score: number;
}

export interface ClientCctvPriorityCountryCoverage {
  country: string;
  tier: ClientCctvPriorityTier;
  cameras: number;
  status: ClientCctvPriorityStatus;
}

export interface ClientCctvCoverageSnapshot {
  scope: 'global' | 'request';
  total_cameras: number;
  countries_seen: number;
  unknown_country_cameras: number;
  suspected_duplicates: number;
  request_regions: string[];
  priority_regions: ClientCctvMacroRegionId[];
  priority_countries?: ClientCctvPriorityCountryCoverage[];
  generated_at: string;
  regions: ClientCctvMacroCoverage[];
}

let currentCoverage: ClientCctvCoverageSnapshot | null = null;
let globalCoverage: ClientCctvCoverageSnapshot | null = null;
let version = 0;
const listeners = new Set<() => void>();

function clone(snapshot: ClientCctvCoverageSnapshot | null) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    request_regions: [...snapshot.request_regions],
    priority_regions: [...snapshot.priority_regions],
    priority_countries: snapshot.priority_countries?.map(country => ({ ...country })),
    regions: snapshot.regions.map(region => ({
      ...region,
      countries: region.countries.map(country => ({ ...country })),
      provider_counts: { ...region.provider_counts },
      feed_counts: { ...region.feed_counts },
      watchlist_missing: [...region.watchlist_missing],
      watchlist_weak: [...region.watchlist_weak],
    })),
  };
}

export function setCctvCoverage(
  current?: ClientCctvCoverageSnapshot,
  global?: ClientCctvCoverageSnapshot,
) {
  if (current) currentCoverage = clone(current);
  if (global) globalCoverage = clone(global);
  version += 1;
  listeners.forEach(listener => listener());
}

export function getCctvCoverageSnapshot() {
  return {
    current: clone(currentCoverage),
    global: clone(globalCoverage),
  };
}

export function getCctvCoverageVersion() {
  return version;
}

export function subscribeCctvCoverage(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
