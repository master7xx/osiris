import { describe, expect, it } from 'vitest';
import {
  classifyEventText,
  eventTitleSimilarity,
  fuseEvents,
  shouldFuseEvents,
  type IncomingEvent,
} from './event-fusion';

function event(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    id: 'src-a-1',
    title: 'Explosion reported in central Kyiv',
    description: 'A blast was reported in Kyiv.',
    category: 'conflict',
    occurred_at: '2026-09-12T06:00:00.000Z',
    discovered_at: '2026-09-12T06:02:00.000Z',
    lat: 50.4501,
    lng: 30.5234,
    location: 'Kyiv, Ukraine',
    location_confidence: 0.98,
    severity: 72,
    evidence: [{
      source_id: 'source-a',
      source: 'Source A',
      kind: 'editorial',
      independent: true,
      weight: 1.1,
      url: 'https://example.test/a',
    }],
    ...overrides,
  };
}

describe('event fusion', () => {
  it('classifies common event categories before generic conflict terms', () => {
    expect(classifyEventText('M6.1 earthquake strikes offshore')).toBe('earthquake');
    expect(classifyEventText('Large protest gathers in capital')).toBe('protest');
    expect(classifyEventText('Missile attack reported overnight')).toBe('conflict');
    expect(classifyEventText('Routine diplomatic meeting')).toBe('other');
  });

  it('detects similar titles across wording changes', () => {
    expect(eventTitleSimilarity(
      'Explosion reported in central Kyiv',
      'Central Kyiv explosion reported overnight',
    )).toBeGreaterThan(0.6);
  });

  it('fuses nearby corroborating reports into one event', () => {
    const a = event();
    const b = event({
      id: 'src-b-1',
      title: 'Central Kyiv explosion reported overnight',
      discovered_at: '2026-09-12T06:05:00.000Z',
      lat: 50.452,
      lng: 30.52,
      evidence: [{
        source_id: 'source-b',
        source: 'Source B',
        kind: 'osint',
        independent: true,
        weight: 0.9,
        url: 'https://example.test/b',
      }],
    });

    expect(shouldFuseEvents(a, b)).toBe(true);
    const fused = fuseEvents([a, b], { now: Date.parse('2026-09-12T06:10:00.000Z') });
    expect(fused).toHaveLength(1);
    expect(fused[0].source_count).toBe(2);
    expect(fused[0].independent_sources).toBe(2);
    expect(fused[0].confidence).toBe('confirmed');
    expect(fused[0].urls).toHaveLength(2);
  });

  it('does not collapse separate nearby earthquakes unless time-space or title match is tight', () => {
    const a = event({
      id: 'usgs-a',
      title: 'M5.2 earthquake beneath Sakura Ridge',
      category: 'earthquake',
      lat: 35,
      lng: 140,
      occurred_at: '2026-09-12T05:00:00.000Z',
      evidence: [{
        source_id: 'usgs-earthquakes',
        source: 'USGS Earthquakes',
        kind: 'sensor',
        independent: true,
        weight: 1.5,
        url: 'https://earthquake.usgs.gov/event/a',
      }],
    });
    const b = event({
      id: 'usgs-b',
      title: 'M4.8 tremor under Harbor Basin',
      category: 'earthquake',
      lat: 35.25,
      lng: 140.2,
      occurred_at: '2026-09-12T06:30:00.000Z',
      evidence: [{
        source_id: 'usgs-earthquakes',
        source: 'USGS Earthquakes',
        kind: 'sensor',
        independent: true,
        weight: 1.5,
        url: 'https://earthquake.usgs.gov/event/b',
      }],
    });
    expect(shouldFuseEvents(a, b)).toBe(false);
  });

  it('treats authoritative sensor evidence as confirmed without requiring a second source', () => {
    const fused = fuseEvents([event({
      id: 'usgs-1',
      title: 'M6.0 earthquake offshore',
      category: 'earthquake',
      evidence: [{
        source_id: 'usgs-earthquakes',
        source: 'USGS Earthquakes',
        kind: 'sensor',
        independent: true,
        weight: 1.5,
        url: 'https://earthquake.usgs.gov/example',
      }],
    })], { now: Date.parse('2026-09-12T06:10:00.000Z') });
    expect(fused[0].confidence).toBe('confirmed');
  });
});

describe('authoritative hazard identities', () => {
  const hazard = (source: string, id: string, overrides: Partial<IncomingEvent> = {}) => event({
    id, category: 'earthquake', title: 'M5.0 earthquake offshore',
    evidence: [{ source_id: source, source, kind: 'sensor', independent: true, weight: 1,
      url: 'https://example.test/shared-catalog' }], ...overrides,
  });
  it.each([['usgs-earthquakes', 'usgs:'], ['gdacs', 'gdacs:EQ:']])
  ('keeps different %s IDs separate despite identical text, place, time and URL', (source, prefix) => {
    const a = hazard(source, `${prefix}1`);
    const b = hazard(source, `${prefix}2`);
    expect(shouldFuseEvents(a, b)).toBe(false);
    expect(shouldFuseEvents(b, a)).toBe(false);
    expect(fuseEvents([a, b])).toHaveLength(2);
  });
  it.each([['usgs-earthquakes', 'usgs:1'], ['gdacs', 'gdacs:EQ:1']])
  ('retains updates to the same %s event', (source, id) => {
    const a = hazard(source, id);
    const b = hazard(source, id, { title: 'Updated earthquake magnitude 5.2', lat: 50.5 });
    expect(fuseEvents([a, b])).toHaveLength(1);
  });
  it('keeps GDACS event types separate even when numeric IDs coincide', () => {
    expect(shouldFuseEvents(hazard('gdacs', 'gdacs:EQ:1'), hazard('gdacs', 'gdacs:FL:1'))).toBe(false);
  });
  it('blocks a cross-source bridge for every ordering of the reports', () => {
    const a = hazard('usgs-earthquakes', 'usgs:1');
    const b = hazard('usgs-earthquakes', 'usgs:2');
    const bridge = hazard('gdacs', 'gdacs:EQ:3');
    for (const input of [[a,b,bridge], [a,bridge,b], [b,a,bridge], [b,bridge,a], [bridge,a,b], [bridge,b,a]]) {
      expect(fuseEvents(input)).toHaveLength(2);
    }
  });
  it('requires time and known distance for earthquakes without a shared report', () => {
    const a = hazard('usgs-earthquakes', 'usgs:1', { evidence: [] });
    const b = hazard('gdacs', 'gdacs:EQ:1', { evidence: [] });
    expect(shouldFuseEvents(a,b)).toBe(true);
    expect(shouldFuseEvents(a,{ ...b, lat: -30 })).toBe(false);
    expect(shouldFuseEvents(a,{ ...b, lat: undefined, lng: undefined })).toBe(false);
    expect(shouldFuseEvents(a,{ ...b, occurred_at: '2026-09-12T07:00:00Z' })).toBe(false);
  });
});
