import { describe, expect, it } from 'vitest';
import { projectUnifiedConflicts } from './conflict-projection';
import type { FusedEvent } from './event-fusion';

function fused(overrides: Partial<FusedEvent> = {}): FusedEvent {
  return {
    id: 'evt-1',
    title: 'Missile strike reported in Kyiv',
    description: 'Multiple sources report an overnight strike.',
    category: 'conflict',
    categories: ['conflict'],
    occurred_at: '2026-09-12T06:00:00.000Z',
    first_seen_at: '2026-09-12T06:02:00.000Z',
    last_seen_at: '2026-09-12T06:05:00.000Z',
    lat: 50.4501,
    lng: 30.5234,
    location: 'Kyiv, Ukraine',
    location_confidence: 0.98,
    severity: 80,
    priority_score: 91,
    confidence: 'confirmed',
    status: 'active',
    evidence: [],
    sources: ['Source A', 'Source B'],
    source_count: 2,
    independent_sources: 2,
    evidence_weight: 2,
    urls: ['https://example.test/kyiv'],
    tags: [],
    age_minutes: 5,
    ...overrides,
  };
}

describe('legacy conflict projection', () => {
  it('projects real unified coordinates without synthetic offsets', () => {
    const input = fused();
    const result = projectUnifiedConflicts([input], Date.parse('2026-09-12T06:10:00Z'));
    expect(result.liveEvents).toHaveLength(1);
    expect(result.liveEvents[0].lat).toBe(input.lat);
    expect(result.liveEvents[0].lng).toBe(input.lng);
    expect(result.liveEvents[0].confidence).toBe('confirmed');
    const ukraine = result.zones.find(zone => zone.id === 'ukraine');
    expect(ukraine?.eventCount).toBe(1);
    expect(ukraine?.events[0].id).toBe(input.id);
  });

  it('counts a location-text match in its contextual zone without fabricating a marker', () => {
    const input = fused({
      id: 'evt-no-coords',
      title: 'Ukraine reports new military incident',
      lat: undefined,
      lng: undefined,
      location: 'Ukraine',
      location_confidence: 0,
    });
    const result = projectUnifiedConflicts([input]);
    expect(result.liveEvents).toEqual([]);
    const ukraine = result.zones.find(zone => zone.id === 'ukraine');
    expect(ukraine?.eventCount).toBe(1);
    expect(ukraine?.events).toEqual([]);
  });

  it('does not project non-conflict hazard events into conflict zones', () => {
    const result = projectUnifiedConflicts([
      fused({ category: 'earthquake', categories: ['earthquake'], title: 'M5.5 earthquake in Ukraine' }),
    ]);
    expect(result.liveEvents).toEqual([]);
    expect(result.zones.find(zone => zone.id === 'ukraine')?.eventCount).toBe(0);
  });

  it('requires sufficiently precise coordinates for legacy live map events', () => {
    const result = projectUnifiedConflicts([
      fused({ id: 'low-geo', location_confidence: 0.45 }),
    ]);
    expect(result.liveEvents).toEqual([]);
    // Text can still contribute to the zone counter, but no fake point is emitted.
    expect(result.zones.find(zone => zone.id === 'ukraine')?.eventCount).toBe(1);
  });

  it('can map events into a zone by coordinates even when the title omits the country', () => {
    const result = projectUnifiedConflicts([
      fused({
        id: 'gaza-event',
        title: 'Airstrike reported overnight',
        description: '',
        location: undefined,
        lat: 31.5,
        lng: 34.45,
      }),
    ]);
    expect(result.zones.find(zone => zone.id === 'gaza')?.eventCount).toBe(1);
  });
});
