import { expect, it } from 'vitest';
import { reviewHistoricalIdentities } from './historical-identity-review';
import type { IncomingEvent } from './event-fusion';
it('distinguishes singleton history from composite context without assigning composite content', () => {
  const links = ['a', 'b', 'missing'].map(upstream_id => ({ event_id: 'parent', revision: '3', source_id: 'news:test', upstream_id }));
  const payload = (keys: string[], title: string) => ({ title, occurred_at: '2026-09-30T12:00:00Z', evidence: keys.map(url => ({ source_id: 'news:test', url })) } as IncomingEvent);
  const history = [ { event_id: 'parent', revision: '1', committed_at: 'now', payload: payload(['a', 'b'], 'Composite') },
    { event_id: 'parent', revision: '2', committed_at: 'now', payload: payload(['a'], 'School strike') } ];
  const report = reviewHistoricalIdentities(links, history);
  expect(report.identities.map(i => i.status).sort()).toEqual(['composite_context_only', 'missing_history', 'singleton_context_available']);
  expect(report.executable).toBe(false);
  expect(JSON.stringify(report)).not.toContain('upstream_id');
  expect(reviewHistoricalIdentities([...links].reverse(), [...history].reverse())).toEqual(report);
});
