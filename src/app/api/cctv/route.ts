import { getCctvProviderHealth, noteCctvProviderResponse } from '@/lib/cctv-provider-health';
import { getCctvWithMacroRouting } from './route-proxy';

export const maxDuration = 60;

export async function GET(request: Request) {
  const response = await getCctvWithMacroRouting(request);
  if (!response.ok) return response;

  try {
    const payload = await response.clone().json() as {
      cameras?: Array<{ id?: string; source?: string }>;
      [key: string]: unknown;
    };
    const cameras = Array.isArray(payload.cameras) ? payload.cameras : [];
    noteCctvProviderResponse(cameras);

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');

    return new Response(JSON.stringify({
      ...payload,
      health: getCctvProviderHealth(),
    }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    // Telemetry must never turn a working CCTV response into a failure.
    return response;
  }
}
