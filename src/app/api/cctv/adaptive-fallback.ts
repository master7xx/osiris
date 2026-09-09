export interface CctvFallbackPlan {
  trigger: 'http-error' | 'empty';
  requestedRegions: string[];
  fallbackRegions: string[];
}

const FALLBACKS: Record<string, string[]> = {
  uk: ['europe-live'],
  europe: ['europe-live'],
  netherlands: ['europe-live'],
  bulgaria: ['europe-live'],
  greece: ['europe-live'],
  serbia: ['europe-live'],
  macedonia: ['europe-live'],
  romania: ['europe-live'],
  italy: ['europe-live'],
  czechia: ['europe-live'],
  slovakia: ['europe-live'],
  germany: ['europe-live'],
  france: ['europe-live'],
  spain: ['europe-live'],
  poland: ['europe-live'],
  finland: ['europe-live'],
  iceland: ['europe-live'],
  turkey: ['westasia', 'asia-live', 'europe-live'],
  'middle-east': ['westasia', 'asia-live'],
  japan: ['eastasia', 'asia-live'],
  hongkong: ['eastasia', 'asia-live'],
  taiwan: ['eastasia', 'asia-live'],
  thailand: ['seasia', 'asia-live'],
  eastasia: ['asia-live'],
  seasia: ['asia-live'],
  westasia: ['asia-live'],
};

function explicitRegions(url: string): string[] {
  const value = new URL(url).searchParams.get('region');
  if (!value || value === 'all') return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * Plan a second-source fetch only after an actual failure signal.
 *
 * A slow but successful response never reaches this planner. Camera count is
 * intentionally binary here: zero can represent a swallowed HTTP/schema/empty
 * upstream failure, while "few cameras" can be perfectly legitimate and must
 * not cause extra traffic or health penalties.
 */
export function planCctvFallback(
  requestUrl: string,
  responseOk: boolean,
  cameraCount: number,
  resolvedRegions: string[] = [],
): CctvFallbackPlan | null {
  if (responseOk && cameraCount > 0) return null;

  const url = new URL(requestUrl);
  if (url.searchParams.get('region') === 'all') return null;

  const requestedRegions = explicitRegions(requestUrl);
  const seeds = requestedRegions.length > 0 ? requestedRegions : resolvedRegions;
  if (seeds.length === 0) return null;

  const already = new Set(seeds);
  const fallbackRegions: string[] = [];
  for (const region of seeds) {
    for (const fallback of FALLBACKS[region] ?? []) {
      if (already.has(fallback) || fallbackRegions.includes(fallback)) continue;
      fallbackRegions.push(fallback);
    }
  }
  if (fallbackRegions.length === 0) return null;

  return {
    trigger: responseOk ? 'empty' : 'http-error',
    requestedRegions: seeds,
    fallbackRegions,
  };
}

export function fallbackRequestUrl(requestUrl: string, plan: CctvFallbackPlan): string {
  const url = new URL(requestUrl);
  url.searchParams.set('region', plan.fallbackRegions.join(','));
  url.searchParams.delete('lat');
  url.searchParams.delete('lng');
  url.searchParams.delete('radius');
  return url.toString();
}
