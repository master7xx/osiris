import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNwsAlerts, parseNwsAlerts, type NwsFeature } from './nws-alerts';
import { fuseEvents } from './event-fusion';
import { applyEventLedger, resetEventLedgerForTests } from './event-ledger';
import { DEFAULT_EVENT_FILTERS, projectWorldEvents } from './world-events-view';
const now = Date.parse('2026-09-12T12:00:00Z');
const feature = (id = 'urn:alert:1'): NwsFeature => ({ geometry: { type: 'Point', coordinates: [-97, 35] }, properties: {
  id, '@id': `https://api.weather.gov/alerts/${id}`, status: 'Actual', messageType: 'Alert', event: 'Flash Flood Warning',
  headline: 'Flash Flood Warning for Example County', description: 'Heavy rain.', instruction: 'Avoid flooded roads.',
  sent: '2026-09-12T11:00:00Z', expires: '2026-09-12T13:00:00Z', severity: 'Severe', areaDesc: 'Example County',
} });
afterEach(() => { vi.unstubAllGlobals(); resetEventLedgerForTests(); });
describe('NWS warning adapter', () => {
  it('preserves official provenance, instructions, category and severity', () => {
    const [event] = parseNwsAlerts({ features: [feature()] }, now);
    expect(event.category).toBe('flood'); expect(event.severity).toBe(75);
    expect(event.description).toBe('Heavy rain.\n\nAvoid flooded roads.');
    expect(event.evidence[0].source_id).toBe('noaa-nws');
    expect(event.lat).toBe(35); expect(event.location_confidence).toBe(1);
  });
  it('keeps unlocated warnings and avoids treating a polygon as an exact incident point', () => {
    const absent = feature('absent'); absent.geometry = null;
    const polygon = feature('polygon'); polygon.geometry = { type: 'Polygon', coordinates: [[[-98, 34], [-97, 34], [-97, 35], [-98, 34]]] };
    const events = parseNwsAlerts({ features: [absent, polygon] }, now);
    expect(events).toHaveLength(2); expect(events[0].lat).toBeUndefined(); expect(events[1].location_confidence).toBeLessThan(0.75);
  });
  it('rejects test, cancelled, expired and malformed alerts', () => {
    const rows = [{ status: 'Test' }, { messageType: 'Cancel' }, { expires: '2026-09-12T11:00:00Z' }, { sent: 'bad' }, { id: '', '@id': '' }].map(p => ({ ...feature(), properties: { ...feature().properties, ...p } }));
    expect(parseNwsAlerts({ features: rows }, now)).toEqual([]);
  });
  it('does not call fire-weather forecasts actual wildfires', () => {
    const row = feature(); row.properties!.event = 'Red Flag Warning';
    expect(parseNwsAlerts({ features: [row] }, now)[0].category).toBe('weather');
  });
  it('keeps distinct messages separate across repeated fusion and ledger refreshes', () => {
    for (let i = 0; i < 20; i++) {
      const events = parseNwsAlerts({ features: [feature('one'), feature('two'), feature('one')] }, now + i * 1000);
      const fused = fuseEvents(events, { now });
      expect(fused).toHaveLength(2);
      const ledger = applyEventLedger(fused, now + i * 1000);
      expect(ledger.events).toHaveLength(2);
      expect(ledger.events.every(e => e.update_count === 0)).toBe(true);
    }
  });
  it('expires cached warnings without deleting history', () => {
    const ledger = applyEventLedger(fuseEvents(parseNwsAlerts({ features: [feature()] }, now), { now }), now);
    expect(projectWorldEvents(ledger.events, DEFAULT_EVENT_FILTERS, now).events).toHaveLength(1);
    expect(projectWorldEvents(ledger.events, DEFAULT_EVENT_FILTERS, now + 3600000).events).toHaveLength(0);
    expect(ledger.events).toHaveLength(1);
  });
  it('surfaces HTTP and malformed responses instead of claiming a healthy empty feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{"features":[]}')));
    await expect(fetchNwsAlerts()).rejects.toThrow('503');
    await expect(fetchNwsAlerts()).rejects.toThrow('Invalid NWS');
    await expect(fetchNwsAlerts()).resolves.toEqual({ features: [] });
  });
});
