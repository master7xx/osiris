// CelesTrak constellation groups — many smaller groups to avoid 403 rate limits
const CT = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=';
const FMT = '&FORMAT=tle';
export const CELESTRAK_GROUPS = [
  // Full catalogs
  `${CT}active${FMT}`, 
  // Use supplemental feed for Starlink to avoid strict rate limits on the primary group
  `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=tle`,
  // Navigation (GPS, GLONASS, Galileo, BeiDou)
  `${CT}gps-ops${FMT}`, `${CT}glonass-operational${FMT}`, `${CT}galileo${FMT}`, `${CT}beidou${FMT}`,
  // Communications
  `${CT}oneweb${FMT}`, `${CT}iridium-NEXT${FMT}`, `${CT}globalstar${FMT}`, `${CT}orbcomm${FMT}`,
  `${CT}intelsat${FMT}`, `${CT}ses${FMT}`, `${CT}other-comm${FMT}`, `${CT}x-comm${FMT}`,
  // Stations & Science
  `${CT}stations${FMT}`, `${CT}education${FMT}`, `${CT}engineering${FMT}`, `${CT}science${FMT}`,
  // Weather & Earth observation
  `${CT}weather${FMT}`, `${CT}resource${FMT}`, `${CT}sarsat${FMT}`, `${CT}planet${FMT}`,
  `${CT}goes${FMT}`, `${CT}argos${FMT}`, `${CT}dmc${FMT}`, `${CT}spire${FMT}`,
  // Military / Government
  `${CT}military${FMT}`, `${CT}radar${FMT}`, `${CT}geodetic${FMT}`, `${CT}tdrss${FMT}`,
  // GEO belt
  `${CT}geo${FMT}`,
  // Small sats & cubesats
  `${CT}cubesat${FMT}`, `${CT}amateur${FMT}`,
  // Recently launched (catches new Starlinks)
  `${CT}last-30-days${FMT}`,
  // Visual / high-interest
  `${CT}visual${FMT}`,
  // Supplemental
  `${CT}supplemental${FMT}`,
  // Debris fields (thousands of tracked objects)
  `${CT}fengyun-1c-debris${FMT}`, `${CT}cosmos-2251-debris${FMT}`,
  `${CT}iridium-33-debris${FMT}`, `${CT}cosmos-1408-debris${FMT}`,
  // Other NOAA
  `${CT}nnss${FMT}`, `${CT}musson${FMT}`,
];

/** Parse raw 3-line TLE text into satellite objects */
export function parseTLEText(text: string): { name: string; line1: string; line2: string }[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const sats: { name: string; line1: string; line2: string }[] = [];
  let i = 0;
  while (i < lines.length - 1) {
    if (!lines[i].startsWith('1') && lines[i + 1]?.startsWith('1') && lines[i + 2]?.startsWith('2')) {
      sats.push({ name: lines[i].replace(/^0\s+/, '').trim(), line1: lines[i + 1], line2: lines[i + 2] });
      i += 3;
    } else if (lines[i].startsWith('1') && lines[i + 1]?.startsWith('2')) {
      const noradId = lines[i].substring(2, 7).trim();
      sats.push({ name: `SAT-${noradId}`, line1: lines[i], line2: lines[i + 1] });
      i += 2;
    } else {
      i++;
    }
  }
  return sats;
}

export interface GroupHealth {
  group: string;
  state: 'ok' | 'error';
  observed_at: string;
  records: number;
  http_status?: number;
  error?: string;
}
export async function fetchCelesTrakGroup(url: string) {
  const params = new URL(url).searchParams;
  const group = params.get('GROUP') ?? `supplemental:${params.get('FILE') ?? 'unknown'}`;
  const health: GroupHealth = { group, state: 'error', observed_at: new Date().toISOString(), records: 0 };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30000), cache: 'no-store',
      headers: { 'User-Agent': 'OSIRIS/4.2 (satellite-tracker)' },
    });
    health.http_status = res.status;
    if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
    const text = await res.text();
    const satellites = parseTLEText(text);
    if (text.includes('has not updated since') || !satellites.length) throw new Error('No valid TLE records');
    return { satellites, health: { ...health, state: 'ok' as const, records: satellites.length } };
  } catch (error) {
    health.error = error instanceof Error ? error.message : 'Fetch failed';
    return { satellites: [], health };
  }
}
