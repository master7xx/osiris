import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSwpcAlerts, parseSwpcEvents, SWPC_ALERTS_URL } from './swpc-alerts';
import { fuseEvents, shouldFuseEvents } from './event-fusion';
import { applyEventLedger, resetEventLedgerForTests } from './event-ledger';
import { DEFAULT_EVENT_FILTERS, isMappable, projectWorldEvents } from './world-events-view';
import { observationIndex, collectorIdentities } from './collector-observations';

const now = Date.parse('2026-09-12T08:00:00Z');
function bulletin(serial = '10', time = '2026-09-12 06:45:35.603', extra = '') {
  return { product_id: 'K05A', issue_datetime: time,
    message: `Space Weather Message Code: ALTK05\r\nSerial Number: ${serial}\r\n\r\nALERT: Geomagnetic K-index of 5\nNOAA Scale: G1 - Minor\n${extra}` };
}
afterEach(() => { vi.unstubAllGlobals(); resetEventLedgerForTests(); });

describe('SWPC bulletin adapter', () => {
  it('uses UTC and official provenance without ground coordinates', () => {
    const [event] = parseSwpcEvents([bulletin()], now);
    expect(event.occurred_at).toBe('2026-09-12T06:45:35.603Z');
    expect(event).toMatchObject({ category: 'weather', severity: 40, location_confidence: 0 });
    expect(event.lat).toBeUndefined();
    expect(event.evidence[0]).toMatchObject({ source_id: 'noaa-swpc', upstream_id: '["ALTK05","10"]', url: SWPC_ALERTS_URL });
  });
  it('keeps the latest correction independent of feed order', () => {
    const old = bulletin(); const correction = bulletin('10', '2026-09-12 07:00:00.000', 'CORRECTED');
    for (const rows of [[old, correction], [correction, old]]) {
      const result = parseSwpcEvents(rows, now);
      expect(result).toHaveLength(1);
      expect(result[0].description).toContain('CORRECTED');
    }
  });
  it('uses publication time when serial number is missing', () => {
    const rows = [bulletin(), bulletin('11', '2026-09-12 07:00:00.000')].map(row => ({ ...row, message: 'ALERT: test' }));
    expect(new Set(parseSwpcEvents(rows, now).map(event => event.id)).size).toBe(2);
  });
  it('rejects malformed collections and excludes stale or far-future reports', () => {
    expect(() => parseSwpcEvents({}, now)).toThrow();
    expect(() => parseSwpcEvents([null], now)).toThrow();
    expect(() => parseSwpcEvents([bulletin('1', 'invalid')], now)).toThrow();
    expect(parseSwpcEvents([bulletin('1', '2026-08-01 00:00:00'), bulletin('2', '2026-09-13 00:00:00')], now)).toEqual([]);
  });
  it('keeps cancellation as an explicitly named historical notice', () => {
    const row = bulletin(); row.message = 'CANCEL WATCH: Geomagnetic Storm Category G2 Predicted';
    const [event] = parseSwpcEvents([row], now);
    expect(event.title).toContain('CANCEL WATCH');
    expect(event.tags).toContain('cancellation-notice');
    expect(event.severity).toBe(15);
  });
  it('does not merge shared feed URLs or similar bulletins over 50 refresh/reload cycles', () => {
    let cached: ReturnType<typeof applyEventLedger>['events'] = [];
    let ids: string[] = [];
    for (let cycle = 0; cycle < 50; cycle++) {
      const at = now + cycle * 60000;
      const incoming = parseSwpcEvents([bulletin(), bulletin('11', '2026-09-12 07:00:00.000')], at);
      const fused = fuseEvents(incoming, { now: at });
      expect(fused).toHaveLength(2);
      expect(new Set(fused.map(event => JSON.stringify(collectorIdentities(event)))).size).toBe(2);
      const ledger = applyEventLedger(fused, at);
      const view = projectWorldEvents([...JSON.parse(JSON.stringify(cached)), ...ledger.events], { ...DEFAULT_EVENT_FILTERS, category: 'weather' }, at);
      expect(view.events).toHaveLength(2);
      expect(view.sources.map(source => source.source_id)).toEqual(['noaa-swpc']);
      expect(view.events.every(event => !isMappable(event))).toBe(true);
      const nextIds = view.events.map(event => event.id).sort();
      if (cycle) expect(nextIds).toEqual(ids);
      ids = nextIds; cached = view.events;
      expect(projectWorldEvents(cached, { ...DEFAULT_EVENT_FILTERS, category: 'conflict' }, at).events).toEqual([]);
    }
  });
  it('matches a rebuilt report identity but not another provider or serial', () => {
    const [event] = parseSwpcEvents([bulletin()], now);
    expect(shouldFuseEvents(event, { ...event, id: 'rebuilt' })).toBe(true);
    expect(shouldFuseEvents(event, { ...event, id: 'other', evidence: [{ ...event.evidence[0], source_id: 'other' }] })).toBe(false);
    const [other] = parseSwpcEvents([bulletin('11')], now);
    expect(shouldFuseEvents(event, other)).toBe(false);
    const index = observationIndex([{ payload: event, observed_at: new Date(now) }, { payload: other, observed_at: new Date(now + 1000) }]);
    expect(index(fuseEvents([event], { now })[0])).toBe(new Date(now).toISOString());
  });
  it('fails HTTP and malformed responses instead of reporting healthy-empty', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: 'down' })).mockResolvedValueOnce(Response.json([bulletin()]));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchSwpcAlerts()).rejects.toThrow('503');
    await expect(fetchSwpcAlerts()).rejects.toThrow('collection');
    await expect(fetchSwpcAlerts()).resolves.toHaveLength(1);
  });
});
