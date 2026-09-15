import { expect, it } from 'vitest';
import { inspectIdentityConflicts } from './identity-conflict-report';
const id = (upstreamId: string) => ({ sourceId: 'news', upstreamId });
const match = (upstream_id: string, event_id: string) => ({ source_id: 'news', upstream_id, event_id, revision: '2' });
it('distinguishes a bridge between stored events from a repeated target', () => {
  const conflicts = inspectIdentityConflicts([
    { id: 'bridge', identities: [id('a'), id('b')] },
    { id: 'first', identities: [id('a')] },
    { id: 'repeat', identities: [id('a')] },
  ], [match('a', 'event-a'), match('b', 'event-b')]);
  expect(conflicts.map(c => [c.position, c.reason, c.earlier_accepted_position])).toEqual([
    [0, 'multiple_stored_events', null], [2, 'repeated_stored_event', 1],
  ]);
  expect(conflicts[0].links.flatMap(l => l.events.map(e => e.id))).toEqual(['event-a', 'event-b']);
});
it('does not treat multiple identities of one stored event as a conflict', () => {
  expect(inspectIdentityConflicts([{ id: 'one', identities: [id('a'), id('b'), id('a')] }],
    [match('a', 'event'), match('b', 'event')])).toEqual([]);
});
it('preserves the first accepted position even when that position is zero', () => {
  const result = inspectIdentityConflicts(['a', 'b', 'c'].map(n => ({ id: n, identities: [id(n)] })),
    ['a', 'b', 'c'].map(n => match(n, 'same')));
  expect(result.map(c => c.earlier_accepted_position)).toEqual([0, 0]);
});
it('omits raw upstream URLs and candidate ids while retaining stable link fingerprints', () => {
  const secret = 'https://source.example/report?token=private';
  const candidates = [{ id: secret, identities: [id(secret), id('b')] }];
  const matches = [match(secret, 'a'), match('b', 'b')];
  const result = inspectIdentityConflicts(candidates, matches);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(result[0].links[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(inspectIdentityConflicts(candidates, matches)).toEqual(result);
});
it('allows candidates with no persisted identities and leaves input untouched', () => {
  const input = [{ id: 'new', identities: [id('new')] }];
  const before = structuredClone(input);
  expect(inspectIdentityConflicts(input, [])).toEqual([]);
  expect(input).toEqual(before);
});
