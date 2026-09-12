import { describe, expect, it } from 'vitest';
import { parseGdacsRss, parseGdeltArticles, parseUsgsEarthquakes } from './event-sources';

describe('global event source parsers', () => {
  it('maps GDELT article discovery into normalized events and reuses known-place geolocation', () => {
    const rows = parseGdeltArticles({
      articles: [{
        title: 'Explosion reported in Warsaw after overnight attack',
        url: 'https://example.test/story',
        seendate: '20260912T061500Z',
        domain: 'example.test',
        language: 'English',
        sourcecountry: 'Poland',
      }],
    }, Date.parse('2026-09-12T06:20:00Z'));

    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('conflict');
    expect(rows[0].location).toBe('Warsaw, Poland');
    expect(rows[0].lat).toBeCloseTo(52.2297);
    expect(rows[0].evidence[0].source).toContain('example.test');
  });

  it('parses GDACS coordinates, alert severity and hazard category', () => {
    const xml = `
      <rss><channel><item>
        <title><![CDATA[Orange earthquake alert in Example]]></title>
        <link>https://gdacs.example/event&amp;id=42</link>
        <description><![CDATA[Major seismic event]]></description>
        <geo:lat>35.5</geo:lat><geo:long>140.2</geo:long>
        <gdacs:eventtype>EQ</gdacs:eventtype>
        <gdacs:eventid>42</gdacs:eventid>
        <gdacs:alertlevel>Orange</gdacs:alertlevel>
        <gdacs:country>Japan</gdacs:country>
        <gdacs:fromdate>2026-09-12T05:00:00Z</gdacs:fromdate>
      </item></channel></rss>`;
    const rows = parseGdacsRss(xml, Date.parse('2026-09-12T06:00:00Z'));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('earthquake');
    expect(rows[0].severity).toBe(75);
    expect(rows[0].evidence[0].kind).toBe('official');
    expect(rows[0].evidence[0].url).toBe('https://gdacs.example/event&id=42');
  });

  it('maps USGS sensor events with magnitude-based severity and exact coordinates', () => {
    const rows = parseUsgsEarthquakes({
      features: [{
        id: 'abc123',
        geometry: { coordinates: [142.1, 38.2, 30] },
        properties: {
          mag: 6.3,
          place: 'off the coast',
          time: Date.parse('2026-09-12T04:00:00Z'),
          updated: Date.parse('2026-09-12T04:02:00Z'),
          url: 'https://earthquake.usgs.gov/abc123',
          tsunami: 1,
          alert: 'orange',
        },
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('earthquake');
    expect(rows[0].lat).toBeCloseTo(38.2);
    expect(rows[0].lng).toBeCloseTo(142.1);
    expect(rows[0].severity).toBeGreaterThanOrEqual(88);
    expect(rows[0].evidence[0].kind).toBe('sensor');
  });

  it('drops malformed source rows instead of inventing events', () => {
    expect(parseGdeltArticles({ articles: [{ title: '', url: '' }] })).toEqual([]);
    expect(parseUsgsEarthquakes({ features: [{ id: 'x', geometry: {}, properties: { mag: 5 } }] })).toEqual([]);
    expect(parseGdacsRss('<rss><item><title>Missing coordinates</title></item></rss>')).toEqual([]);
  });
});
