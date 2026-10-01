import { describe, expect, it } from 'vitest';
import { clusterFirmsCsv, parseEonetEvents, parseCloudflareOutages } from './event-signals';
import { fuseEvents, shouldFuseEvents } from './event-fusion';
import { collectorIdentities, observationIndex } from './collector-observations';

const csv = 'latitude,longitude,acq_date,acq_time,frp\n-20.4,126.5,2026-09-30,1200,42\n9.6,-63.5,2026-09-30,1200,42';
describe('provider report identity', () => {
  it('separates distant FIRMS cells and retains their observation time including legacy payloads', () => {
    const rows = clusterFirmsCsv(csv);
    const legacy = rows.map(row => ({ ...row, evidence: row.evidence.map(({ upstream_id: omitted, ...e }) => { void omitted; return e; }) }));
    expect(shouldFuseEvents(legacy[0], legacy[1])).toBe(false);
    const fused = fuseEvents(legacy, { now: Date.parse('2026-09-30T13:00:00Z') });
    expect(fused).toHaveLength(2);
    expect(new Set(fused.flatMap(collectorIdentities).map(i => i.upstreamId)).size).toBe(2);
    const observed = observationIndex(legacy.map(payload => ({ payload, observed_at: '2026-09-30T12:01:00Z' })));
    expect(fused.map(observed)).toEqual(['2026-09-30T12:01:00.000Z', '2026-09-30T12:01:00.000Z']);
    expect(legacy.every(row => !('upstream_id' in row.evidence[0]))).toBe(true);
  });
  it('keeps same cell/day updates together, separates sensors and days', () => {
    const a = clusterFirmsCsv(csv)[0];
    const updated = { ...a, title: 'Active fire cluster · 100 satellite detections' };
    expect(shouldFuseEvents(a, updated)).toBe(true);
    expect(shouldFuseEvents(a, clusterFirmsCsv(csv, 'modis')[0])).toBe(false);
    expect(shouldFuseEvents(a, clusterFirmsCsv(csv.replaceAll('2026-09-30', '2026-10-01'))[0])).toBe(false);
  });
  it('uses EONET and Cloudflare report IDs even when URLs are shared', () => {
    const now = Date.parse('2026-09-30T13:00:00Z');
    const eonet = parseEonetEvents({ events: ['a', 'b'].map(id => ({ id, title: 'Wildfire alert', sources: [{ url: 'https://example.test/catalogue' }], categories: [{ id: 'wildfires' }], geometry: [{ date: '2026-09-30T12:00:00Z', type: 'Point', coordinates: [10, 10] }] })) }, now);
    expect(shouldFuseEvents(eonet[0], eonet[1])).toBe(false);
    const outages = parseCloudflareOutages({ annotations: ['a', 'b'].map(id => ({ id, startDate: '2026-09-30T12:00:00Z', locations: ['US'], linkedUrl: 'https://example.test/catalogue' })) }, now);
    expect(outages).toHaveLength(2);
    expect(shouldFuseEvents(outages[0], outages[1])).toBe(false);
  });
});
