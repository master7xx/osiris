import { expect, it } from 'vitest';
import { reviewNewsIdentities } from './news-identity-review';
import type { IncomingEvent } from './event-fusion';
const now = Date.parse('2026-09-30T18:00:00Z');
const signal = (id: string, title: string): IncomingEvent => ({ id, title, occurred_at: new Date(now).toISOString(), category: 'conflict', severity: 50, lat: 50, lng: 30,
  evidence: [{ source_id: 'news:test', source: 'Test', kind: 'editorial', independent: true, weight: 1, url: `https://example.test/${id}?private=key` }] });
const link = (s: IncomingEvent, event_id: string) => ({ source_id: 'news:test', upstream_id: s.evidence[0].url!, event_id, revision: '2' });
it('exposes a reviewable split without asserting verified provider incident IDs or exposing URLs', () => {
  const a = signal('a', 'Putin proposes negotiations tomorrow');
  const b = signal('b', 'School building damaged after strike');
  const result = reviewNewsIdentities([a,b], [link(a,'old'),link(b,'old')], now);
  expect(result.components[0]).toMatchObject({ action: 'review_split', executable: false });
  expect(result.stored_events[0].incomplete).toBe(false);
  expect(result.current_groups).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain('private=key');
  expect(reviewNewsIdentities([b,a], [link(b,'old'),link(a,'old')], now)).toEqual(result);
});
it('groups converging stored events and blocks missing historical keys', () => {
  const a = signal('a', 'Explosion reported in central Kyiv');
  const b = signal('b', 'Central Kyiv explosion reported overnight');
  const links = [link(a,'first'),link(b,'second')];
  expect(reviewNewsIdentities([a,b],links,now).components[0]).toMatchObject({ action: 'review_merge', stored_event_ids: ['first','second'], executable: false });
  links.push({ ...links[0], upstream_id: 'missing' });
  expect(reviewNewsIdentities([a,b],links,now).components[0].action).toBe('review_missing_or_ambiguous_observations');
});
it('keeps conflicting digest/withdrawal identity observations explicitly ambiguous', () => {
  const a = signal('a','Explosion in central Kyiv');
  const b = { ...a, withdrawn: true };
  const result = reviewNewsIdentities([a,b], [link(a,'old')], now);
  expect(result.stored_events[0].identities[0].status).toBe('ambiguous_current_identity');
  expect(result.components[0].action).toBe('review_missing_or_ambiguous_observations');
});
it('blocks a complete proposal when the stored parent also owns unreviewed official identities', () => {
  const a = signal('a','Explosion reported in central Kyiv');
  const result = reviewNewsIdentities([a], [link(a,'old'), { source_id: 'gdacs', upstream_id: 'official', event_id: 'old', revision: '2' }], now);
  expect(result.stored_events[0]).toMatchObject({ non_news_identity_count: 1, incomplete: true });
  expect(result.components[0].action).toBe('review_missing_or_ambiguous_observations');
});
