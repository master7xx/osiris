import { getCctvProviderHealth, noteCctvProviderResponse } from '@/lib/cctv-provider-health';
import {
  analyzeCctvCoverage,
  getGlobalCctvCoverage,
  noteGlobalCctvCoverage,
  type CctvCoverageCamera,
} from '@/lib/cctv-coverage';
import { getCctvWithMacroRouting } from './route-proxy';

export const maxDuration = 60;

function requestCoverageScope(request: Request): 'global' | 'request' {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region');
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  return region === 'all' || (!region && lat === 0 && lng === 0) ? 'global' : 'request';
}

export async function GET(request: Request) {
  const response = await getCctvWithMacroRouting(request);
  if (!response.ok) return response;

  try {
    const payload = await response.clone().json() as {
      cameras?: CctvCoverageCamera[];
      regions?: string[];
      [key: string]: unknown;
    };
    const cameras = Array.isArray(payload.cameras) ? payload.cameras : [];
    noteCctvProviderResponse(cameras);

    const coverage = analyzeCctvCoverage(cameras, {
      scope: requestCoverageScope(request),
      requestRegions: Array.isArray(payload.regions) ? payload.regions : [],
    });
    if (coverage.scope === 'global') noteGlobalCctvCoverage(coverage);
    const globalCoverage = coverage.scope === 'global' ? coverage : getGlobalCctvCoverage();

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');

    return new Response(JSON.stringify({
      ...payload,
      health: getCctvProviderHealth(),
      coverage,
      global_coverage: globalCoverage,
    }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    // Diagnostics must never turn a working CCTV response into a failure.
    return response;
  }
}
