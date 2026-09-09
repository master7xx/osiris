import { getCctvWithMacroRouting } from './route-proxy';

export const maxDuration = 60;

export async function GET(request: Request) {
  return getCctvWithMacroRouting(request);
}
