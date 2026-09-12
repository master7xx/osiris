import { describe, expect, it } from 'vitest';
import { clusterFirmsCsv, parseCloudflareOutages, parseEonetEvents } from './event-signals';

describe('supplemental event signals', () => {
  it('normalizes recent EONET events with exact point geometry', () => {
    const now = Date.parse('2026-09-12T08:00:00Z');
    const events = parseEonetEvents({
      events: [{
        id: 'EONET_1',
        title: 'Example Wildfire',
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        sources: [{ id: 'example', url: 'https://example.test/fire' }],
        geometry: [{
          date: '2026-09-12T07:00:00Z',
          type: 'Point',
          coordinates: [30.5, 50.4],
        }],
      }],
    }, now);

    expect(events).toHaveLength(1);
    expect(events[0].category).toBe('wildfire');
    expect(events[0].lat).toBeCloseTo(50.4);
    expect(events[0].lng).toBeCloseTo(30.5);
    expect(events[0].evidence[0].source).toBe('NASA EONET');
  });

  it('drops stale EONET geometry instead of resurfacing old open events', () => {
    const now = Date.parse('2026-09-12T08:00:00Z');
    expect(parseEonetEvents({
      events: [{
        id: 'old',
        title: 'Old Volcano',
        categories: [{ id: 'volcanoes' }],
        geometry: [{ date: '2026-08-01T00:00:00Z', type: 'Point', coordinates: [140, 35] }],
      }],
    }, now)).toEqual([]);
  });

  it('clusters FIRMS hotspots so raw detections do not become event spam', () => {
    const csv = [
      'latitude,longitude,bright_ti4,confidence,acq_date,acq_time,frp',
      '53.100,27.100,340,n,2026-09-12,0610,12',
      '53.120,27.130,345,n,2026-09-12,0615,15',
      '53.140,27.160,350,h,2026-09-12,0620,18',
      '10.000,10.000,300,l,2026-09-12,0620,1',
    ].join('\n');

    const events = clusterFirmsCsv(csv, 'viirs', 'NASA FIRMS VIIRS');
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe('wildfire');
    expect(events[0].title).toContain('3 satellite detections');
    expect(events[0].lat).toBeCloseTo(53.12, 2);
    expect(events[0].evidence[0].kind).toBe('sensor');
  });

  it('keeps a single unusually energetic FIRMS hotspot', () => {
    const csv = [
      'latitude,longitude,brightness,confidence,acq_date,acq_time,frp',
      '40.000,45.000,410,90,2026-09-12,0700,42',
    ].join('\n');
    const events = clusterFirmsCsv(csv, 'modis', 'NASA FIRMS MODIS');
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBeGreaterThan(50);
  });

  it('normalizes Cloudflare outages but marks country-centroid location as imprecise', () => {
    const now = Date.parse('2026-09-12T08:00:00Z');
    const events = parseCloudflareOutages({
      result: {
        annotations: [{
          id: 'outage-1',
          locations: ['PL'],
          locationsDetails: [{ code: 'PL', name: 'Poland' }],
          scope: 'Country',
          eventType: 'OUTAGE',
          outage: { outageCause: 'Power outage' },
          description: 'Traffic disruption observed',
          startDate: '2026-09-12T06:00:00Z',
          endDate: null,
          linkedUrl: 'https://radar.cloudflare.com/example',
        }],
      },
    }, now);

    expect(events).toHaveLength(1);
    expect(events[0].category).toBe('infrastructure');
    expect(events[0].location).toBe('Poland');
    expect(events[0].location_confidence).toBeLessThan(0.75);
    expect(events[0].evidence[0].source).toBe('Cloudflare Radar');
  });
});
