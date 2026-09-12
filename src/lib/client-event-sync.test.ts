import { describe, it, expect } from 'vitest';
import { synchronizeEvents, validateClientCache, type EventClientCache } from './client-event-sync';
import type { FusedEvent } from './event-fusion';
const time = '2026-09-12T10:00:00Z';
const event: FusedEvent = { id: 'a', title: 'Report A', description: '', category: 'conflict', categories: ['conflict'], occurred_at: time, first_seen_at: time, last_seen_at: time,
  location_confidence: 0, severity: 60, priority_score: 60, confidence: 'unconfirmed', status: 'active', evidence: [], sources: [], source_count: 0, independent_sources: 0, evidence_weight: 0, urls: [], tags: [], age_minutes: 0 };
const collector = { last_success_at: time, source_health: [] };
const row = { id: 'a', revision: '1', cursor: '1', payload: event, first_observed_at: time, last_observed_at: time, changed_at: time };
const change = (title: string, sequence: string) => ({ event_id: 'a', revision: sequence, cursor: sequence, payload: { ...event, title }, committed_at: time });
function queue(...responses: (object | number)[]) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    const next = responses.shift();
    if (next === undefined) throw new Error('Unexpected request');
    return new Response(JSON.stringify(typeof next === 'number' ? {} : next), { status: typeof next === 'number' ? next : 200 });
  };
  return { urls, fetcher };
}
const signal = () => new AbortController().signal;
async function initial(): Promise<EventClientCache> {
  return synchronizeEvents(null, queue({ mode: 'durable', version: 1 }, { events: [row], collector, cursor: 'start' }).fetcher, signal());
}
describe('client event checkpoint synchronization', () => {
  it('bootstraps events and cursor as one coherent checkpoint', async () => {
    const cache = await initial(); expect(cache.cursor).toBe('start'); expect(cache.feed.events[0].id).toBe('a');
  });
  it('applies all delta pages by stable identity without fetching the full snapshot', async () => {
    const previous = await initial();
    const mock = queue({ mode: 'durable', version: 1 }, { changes: [change('B', '2')], collector, cursor: 'page2', has_more: true }, { changes: [change('C', '3')], collector, cursor: 'end', has_more: false });
    const result = await synchronizeEvents(previous, mock.fetcher, signal());
    expect(result.feed.events).toHaveLength(1); expect(result.feed.events[0].title).toBe('C'); expect(result.cursor).toBe('end');
    expect(mock.urls.some(url => url.includes('/stored'))).toBe(false);
    expect(previous.feed.events[0].title).toBe('Report A'); expect(previous.cursor).toBe('start');
  });
  it('keeps the previous data and cursor intact when a later page fails', async () => {
    const previous = await initial(); const before = structuredClone(previous);
    await expect(synchronizeEvents(previous, queue({ mode: 'durable', version: 1 }, { changes: [change('B', '2')], collector, cursor: 'page2', has_more: true }, 503).fetcher, signal())).rejects.toThrow('503');
    expect(previous).toEqual(before);
  });
  it('replaces the cache after a cursor reset and removes events absent from bootstrap', async () => {
    const previous = await initial();
    const result = await synchronizeEvents(previous, queue({ mode: 'durable', version: 1 }, 410, { events: [], collector, cursor: 'reset' }).fetcher, signal());
    expect(result.feed.events).toEqual([]); expect(result.cursor).toBe('reset');
  });
  it('does not silently fall back to snapshot collection during a durable outage', async () => {
    const mock = queue({ mode: 'durable', version: 1 }, 503);
    await expect(synchronizeEvents(await initial(), mock.fetcher, signal())).rejects.toThrow('503');
    expect(mock.urls).toHaveLength(2);
  });
  it('updates observation metadata even when there are no material revisions', async () => {
    const result = await synchronizeEvents(await initial(), queue({ mode: 'durable', version: 1 }, { changes: [], collector, cursor: 'end', has_more: false,
      observations: [{ id: 'a', last_observed_at: '2026-09-12T11:00:00Z', priority_score: 20 }] }).fetcher, signal());
    expect(result.feed.events[0].priority_score).toBe(20); expect(result.feed.events[0].change_sequence).toBe(1);
  });
  it('supports explicit return to snapshot mode and drops the durable cursor', async () => {
    const previous = await initial();
    const result = await synchronizeEvents(previous, queue({ mode: 'snapshot', version: 1 }, previous.feed).fetcher, signal());
    expect(result.mode).toBe('snapshot'); expect(result.cursor).toBeUndefined();
  });
  it('rejects corrupt caches and pages that fail to advance', async () => {
    expect(validateClientCache({ version: 0 })).toBeNull();
    await expect(synchronizeEvents(await initial(), queue({ mode: 'durable', version: 1 }, { changes: [], collector, cursor: 'start', has_more: true }).fetcher, signal())).rejects.toThrow('did not advance');
  });
});

describe('cached category continuity', () => {
  it('retains previously shown categories, replaces updates by ID, and expires old reports', async () => {
    const now = new Date().toISOString();
    const feed = (await initial()).feed;
    const report = (id: string, category: FusedEvent['category'], lastObserved = now) => ({
      ...feed.events[0], id, category, last_observed_at: lastObserved,
    });
    const old = report('expired', 'weather', new Date(Date.now() - 49 * 3600000).toISOString());
    const firstFeed = { ...feed, events: [report('a', 'conflict'), report('b', 'earthquake'), old] };
    const first = await synchronizeEvents(null, queue({ mode: 'snapshot', version: 1 }, firstFeed).fetcher, signal());
    const mock = queue({ mode: 'snapshot', version: 1 }, { ...feed, events: [{ ...report('a', 'conflict'), title: 'Updated' }] });
    const second = await synchronizeEvents(first, mock.fetcher, signal());
    expect(mock.urls).toContain('/api/events/snapshot');
    expect(second.feed.events.map(item => item.id)).toEqual(['a', 'b']);
    expect(second.feed.events[0].title).toBe('Updated');
    expect(second.retainedIds).toEqual(['b']);
    expect(second.feed.events[1].last_observed_at).toBe(now);
    const third = await synchronizeEvents(second, queue({ mode: 'snapshot', version: 1 }, { ...feed, events: [report('b', 'earthquake')] }).fetcher, signal());
    expect(third.retainedIds).toEqual(['a']);
    expect(third.feed.events.filter(item => item.id === 'b')).toHaveLength(1);
  });
});
