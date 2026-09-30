import { expect, it } from 'vitest';
import { fuseEvents, shouldFuseEvents, type IncomingEvent } from './event-fusion';
const now = Date.parse('2026-09-30T18:00:00Z');
function report(id: string, title: string, extra: Partial<IncomingEvent> = {}): IncomingEvent {
  return { id, title, category: 'conflict', occurred_at: new Date(now).toISOString(), lat: 50.4501, lng: 30.5234,
    severity: 50, evidence: [{ source_id: `news:${id}`, source: id, kind: 'editorial', independent: true, weight: 1,
      url: `https://example.test/article/${id}` }], ...extra };
}
it('separates unrelated reports sharing a city centroid, category and publication hour', () => {
  const a = report('a', 'Putin claimed Russia was prepared to resume dialogue with Kyiv following elections');
  const b = report('b', 'Russian terrorists struck a school in Ivankiv Kyiv region');
  expect(shouldFuseEvents(a, b)).toBe(false);
  expect(fuseEvents([a, b], { now })).toHaveLength(2);
});
it('separates different stages of diplomacy even at identical coordinates', () => {
  const a = report('a', 'Iran offers US deal to reopen Strait of Hormuz in seven days');
  const b = report('b', 'Trump rejects Iranian offer to reopen Strait of Hormuz');
  expect(fuseEvents([a, b], { now })).toHaveLength(2);
});
it('retains strong title matches, exact URLs and report updates', () => {
  const a = report('a', 'Explosion reported in central Kyiv');
  const b = report('b', 'Central Kyiv explosion reported overnight');
  expect(fuseEvents([a, b], { now })).toHaveLength(1);
  const update = { ...b, evidence: a.evidence, title: 'Updated casualty count' };
  expect(fuseEvents([a, update], { now })).toHaveLength(1);
  expect(fuseEvents([a, { ...a, title: 'Updated report from the same adapter' }], { now })).toHaveLength(1);
});
it('blocks title-overlap bridges in every order without dropping evidence or signals', () => {
  const a = report('a', 'alpha bravo charlie delta echo foxtrot golf hotel india juliet');
  const b = report('b', 'alpha bravo charlie delta echo foxtrot golf kilo lima mike');
  const c = report('c', 'alpha bravo charlie delta echo kilo lima mike november oscar');
  expect(shouldFuseEvents(a, b)).toBe(true);
  expect(shouldFuseEvents(b, c)).toBe(true);
  expect(shouldFuseEvents(a, c)).toBe(false);
  for (const input of [[a,b,c], [a,c,b], [b,a,c], [b,c,a], [c,a,b], [c,b,a]]) {
    const result = fuseEvents(input, { now });
    expect(result).toHaveLength(2);
    expect(result.flatMap(event => event.evidence)).toHaveLength(3);
  }
});
it('applies the news rule to transport-marked reports and preserves official hazard proximity', () => {
  const a = report('a', 'Negotiations proposed for tomorrow');
  const b = report('b', 'School building damaged after attack');
  for (const event of [a,b]) event.evidence = [{ ...event.evidence[0], source_id: 'rss-provider', transport: 'rss' }];
  expect(shouldFuseEvents(a,b)).toBe(false);
  for (const event of [a,b]) event.evidence = [{ ...event.evidence[0], source_id: 'official-hazard', kind: 'official', transport: undefined }];
  expect(shouldFuseEvents(a,b)).toBe(true);
});
it('keeps exact report updates attached after corroboration by another source', () => {
  const a = report('a', 'Explosion reported in central Kyiv');
  const b = report('b', 'Central Kyiv explosion reported overnight');
  const update = { ...a, title: 'Updated casualty count following investigation', occurred_at: new Date(now - 1000).toISOString() };
  expect(fuseEvents([a,b,update], { now })).toHaveLength(1);
});
