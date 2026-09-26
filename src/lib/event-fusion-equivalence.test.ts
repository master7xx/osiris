import { describe, expect, it } from 'vitest';
import { fuseEvents, shouldFuseEvents, type IncomingEvent, type FusionProfile } from './event-fusion';
import { fuseEvents as reference, shouldFuseEvents as referencePair } from '../../tools/fusion-benchmark/reference';
import { fusionFixture } from '../../tools/fusion-benchmark/fixtures';
const now = Date.parse('2026-09-26T22:00:00Z');
function compare(events: IncomingEvent[], limit = events.length) {
  const original = structuredClone(events);
  expect(fuseEvents(events, { now, limit })).toEqual(reference(events, { now, limit }));
  expect(events).toEqual(original);
}
function row(id: string, extra: Partial<IncomingEvent> = {}): IncomingEvent {
  return { id, title: `Report ${id.repeat(4)}`, category: 'other', occurred_at: new Date(now).toISOString(), severity: 40,
    evidence: [{ source_id: 'editorial', source: 'Editorial', kind: 'editorial', weight: 1, independent: true }], ...extra };
}
function urls(...values: string[]) { return values.map(url => ({ source_id: 'editorial', source: 'Editorial', kind: 'editorial' as const, weight: 1, independent: true, url })); }

describe('fusion equivalence with the frozen pre-optimization implementation', () => {
  it.each([1, 17, 42, 321])('preserves complete output and pair decisions for mixed data, seed %s', seed => {
    const events = fusionFixture(180, seed);
    compare(events); compare([...events].reverse(), 30);
    for (const a of events.slice(0, 50)) for (const b of events) {
      expect(shouldFuseEvents(a, b)).toBe(referencePair(a, b));
    }
  });
  it('keeps first-cluster selection, indexes every appended member, and preserves evidence order', () => {
    const events = [row('a', { evidence: urls('a') }), row('b', { evidence: urls('b') }),
      row('bridge', { evidence: urls('b', 'a', 'c') }), row('later', { evidence: urls('c') })];
    compare(events);
    const result = fuseEvents(events, { now });
    expect(result).toHaveLength(2);
    expect(result.find(event => event.urls.includes('a'))?.urls).toEqual(['a', 'b', 'c']);
  });
  it('keeps whole-cluster hazard veto even when another member matches', () => {
    const hazard = (id: string): IncomingEvent => row(id, { category: 'earthquake', evidence: [
      { ...urls('shared')[0], source_id: 'usgs-earthquakes' } ] });
    const events = [hazard('usgs:one'), row('news', { evidence: urls('shared') }), hazard('usgs:two')];
    compare(events);
    expect(fuseEvents(events, { now })).toHaveLength(2);
  });
  it('retains explicit identity precedence, collection URLs, same-ID precedence, digest and withdrawal gates', () => {
    const evidence = (source: string, upstream_id?: string) => [{ ...urls('collection')[0], source_id: source, upstream_id }];
    const events = [row('a', { evidence: evidence('x', 'one') }), row('b', { evidence: evidence('x', 'two') }),
      row('c', { evidence: evidence('x') }), row('d', { evidence: evidence('y', 'one') }),
      row('a', { evidence: evidence('x', 'three') }), row('e', { evidence: evidence('x', 'one'), withdrawn: true }),
      row('f', { evidence: evidence('x', 'one'), title: 'News digest • first • second' })];
    compare(events);
  });
  it('does not miss fuzzy window boundaries, undefined coordinates, old shared URLs or equal timestamps', () => {
    const events = [0, 1, 8 * 3600000, 8 * 3600000 + 1, 16 * 3600000, 48 * 3600000].map((age, i) =>
      row(`time-${i}`, { title: 'Central region reports major storm today', occurred_at: new Date(now - age).toISOString(),
        ...(i % 2 ? { lat: 10, lng: 20 } : {}), evidence: i > 3 ? urls('old-shared') : [] }));
    compare(events); compare([...events].reverse());
    compare([row('invalid-date', { occurred_at: 'invalid' }), row('short', { title: 'x' }), ...events], 0);
    compare([]);
  });
  it('prepares afresh per invocation, including input mutations', () => {
    const events = fusionFixture(100);
    compare(events);
    events[0].title = 'News digest • first • second';
    events[1].evidence = structuredClone(events[2].evidence);
    events[3].occurred_at = events[0].occurred_at;
    compare(events);
  });
  it('avoids all unrelated comparisons for distinct explicit reports and emits bounded aggregate profiling', () => {
    const events = Array.from({ length: 2000 }, (_, i) => row(`alert-${i}`, { evidence: [
      { ...urls('collection')[0], source_id: 'noaa-nws', upstream_id: String(i) } ] }));
    let profile: FusionProfile | undefined;
    const actual = fuseEvents(events, { now, limit: events.length, onProfile: value => { profile = value; } });
    expect(actual).toHaveLength(events.length);
    expect(profile).toMatchObject({ valid_signals: 2000, clusters: 2000, comparisons: 0, candidate_clusters: 0 });
    for (const value of Object.values(profile!)) expect(Number.isFinite(value) && value >= 0).toBe(true);
  });
});
