import type { IncomingEvent, EventCategory } from '../../src/lib/event-fusion';

/** Deterministic, synthetic data: no production reports or provider requests. */
export function fusionFixture(count: number, seed = 17): IncomingEvent[] {
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const now = Date.parse('2026-09-26T22:00:00Z');
  const categories: EventCategory[] = ['weather', 'earthquake', 'conflict', 'flood', 'cyber', 'other'];
  return Array.from({ length: count }, (_, i) => {
    const source = i % 10 < 7 ? 'noaa-nws' : i % 10 === 7 ? 'usgs-earthquakes' : `news-${i % 5}`;
    const provider = source === 'noaa-nws' || source === 'usgs-earthquakes';
    const group = Math.floor(random() * Math.max(10, count / 4));
    return {
      id: source === 'usgs-earthquakes' ? `usgs:${group}` : `${source}:${group}`,
      title: i % 31 === 0 ? 'Daily briefing • one • two' : `Storm earthquake report region ${group} sector ${i % 19}`,
      description: 'Synthetic fixture for comparing fusion output.',
      category: categories[Math.floor(random() * categories.length)],
      occurred_at: new Date(now - Math.floor(random() * 48 * 3600) * 1000).toISOString(),
      discovered_at: new Date(now - i * 1000).toISOString(),
      ...(i % 3 ? { lat: Math.floor(random() * 150) - 75, lng: Math.floor(random() * 360) - 180 } : {}),
      severity: Math.floor(random() * 100),
      ...(i % 37 === 0 ? { withdrawn: true } : {}),
      evidence: [{ source_id: source, source, kind: provider ? 'official' : 'editorial', independent: true, weight: provider ? 1.5 : 0.8,
        ...(provider && i % 4 ? { upstream_id: String(group) } : {}),
        url: `https://example.test/${source}/${group}` }],
    };
  });
}

/** High-cardinality provider workload, distinct from the dense fuzzy/duplicate fixture. */
export function providerFixture(count: number): IncomingEvent[] {
  return fusionFixture(count).map((event, i) => ({ ...event, id: `provider:${i}`,
    description: 'Synthetic provider notice with operational details. '.repeat(20),
    evidence: [{ ...event.evidence[0], source_id: 'noaa-nws', upstream_id: `alert:${i}`, url: 'https://example.test/alerts' }],
  }));
}
