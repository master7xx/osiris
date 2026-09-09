import { getCctvProviderHealth, noteCctvProviderResponse } from '@/lib/cctv-provider-health';
import {
  analyzeCctvCoverage,
  getGlobalCctvCoverage,
  noteGlobalCctvCoverage,
  type CctvCoverageCamera,
} from '@/lib/cctv-coverage';
import { fallbackRequestUrl, planCctvFallback, type CctvFallbackPlan } from './adaptive-fallback';
import { getCctvWithMacroRouting } from './route-proxy';

export const maxDuration = 60;

type CctvPayload = {
  cameras?: CctvCoverageCamera[];
  regions?: string[];
  sources?: Record<string, number>;
  total?: number;
  [key: string]: unknown;
};

function requestCoverageScope(request: Request): 'global' | 'request' {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region');
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  return region === 'all' || (!region && lat === 0 && lng === 0) ? 'global' : 'request';
}

async function readPayload(response: Response): Promise<CctvPayload | null> {
  try {
    return await response.clone().json() as CctvPayload;
  } catch {
    return null;
  }
}

async function tryAdaptiveFallback(
  request: Request,
  response: Response,
  payload: CctvPayload | null,
): Promise<{ response: Response; payload: CctvPayload | null; plan?: CctvFallbackPlan }> {
  const cameras = Array.isArray(payload?.cameras) ? payload.cameras : [];
  const regions = Array.isArray(payload?.regions) ? payload.regions : [];
  const plan = planCctvFallback(request.url, response.ok, cameras.length, regions);
  if (!plan) return { response, payload };

  const fallbackUrl = fallbackRequestUrl(request.url, plan);
  const fallbackResponse = await getCctvWithMacroRouting(new Request(fallbackUrl, request));
  if (!fallbackResponse.ok) return { response, payload };

  const fallbackPayload = await readPayload(fallbackResponse);
  const fallbackCameras = Array.isArray(fallbackPayload?.cameras) ? fallbackPayload.cameras : [];
  if (fallbackCameras.length === 0) return { response, payload };

  return {
    response: fallbackResponse,
    payload: {
      ...fallbackPayload,
      adaptive_fallback: {
        applied: true,
        trigger: plan.trigger,
        requested_regions: plan.requestedRegions,
        fallback_regions: plan.fallbackRegions,
      },
    },
    plan,
  };
}

export async function GET(request: Request) {
  let response: Response = await getCctvWithMacroRouting(request);
  let payload = await readPayload(response);

  ({ response, payload } = await tryAdaptiveFallback(request, response, payload));
  if (!response.ok) return response;

  try {
    if (!payload) payload = await readPayload(response);
    if (!payload) return response;

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
    // Diagnostics and fallback metadata must never turn a working CCTV response into a failure.
    return response;
  }
}
