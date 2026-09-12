import { describe, expect, it } from 'vitest';
import type { ContinuousEvent } from './event-ledger';
import { DEFAULT_EVENT_FILTERS, filterWorldEvents, isMappable, safeEventUrl } from './world-events-view';
const event = (overrides: Partial<ContinuousEvent> = {}) => ({ id: 'one', category: 'conflict', severity: 80, confidence: 'unconfirmed', lat: 0, lng: 0, location_confidence: 0.9, ...overrides } as ContinuousEvent);
describe('shared map and list filtering', () => {
  it('keeps unlocated events in the default list, but never maps them', () => {
    const items = [event(), event({ id: 'two', lat: undefined })];
    expect(filterWorldEvents(items, DEFAULT_EVENT_FILTERS)).toHaveLength(2);
    expect(filterWorldEvents(items, { ...DEFAULT_EVENT_FILTERS, mappable: true })).toEqual([items[0]]);
  });
  it('accepts real zero coordinates and rejects invalid or uncertain locations', () => {
    expect(isMappable(event())).toBe(true);
    for (const invalid of [{ lat: NaN }, { lng: Infinity }, { lat: 91 }, { lng: -181 }, { location_confidence: 0.74 }]) expect(isMappable(event(invalid))).toBe(false);
  });
  it('combines filters without equating severity with confidence', () => {
    const items = [event(), event({ id: 'two', confidence: 'confirmed', severity: 20 }), event({ id: 'three', confidence: 'confirmed', category: 'weather' })];
    expect(filterWorldEvents(items, { category: 'conflict', confidence: 'confirmed', severity: 70, mappable: false })).toEqual([]);
    expect(filterWorldEvents(items, { ...DEFAULT_EVENT_FILTERS, severity: 70 }).map(item => item.id)).toEqual(['one', 'three']);
  });
  it('allows source links only over HTTP(S)', () => {
    expect(safeEventUrl('https://example.org/news')).toBe('https://example.org/news');
    for (const url of ['javascript:alert(1)', 'data:text/html,test', '/relative', 'invalid']) expect(safeEventUrl(url)).toBeUndefined();
  });
  it('switches categories and restores all events without retaining the previous list', () => {
    const items = [event(), event({ id: 'quake', category: 'earthquake' }), event({ id: 'quake-unlocated', category: 'earthquake', lat: undefined })];
    const select = (category: string) => filterWorldEvents(items, { ...DEFAULT_EVENT_FILTERS, category });
    expect(select('conflict').map(item => item.id)).toEqual(['one']);
    expect(select('earthquake').map(item => item.id)).toEqual(['quake', 'quake-unlocated']);
    expect(select('earthquake').filter(isMappable).map(item => item.id)).toEqual(['quake']);
    expect(select('wildfire')).toEqual([]);
    expect(select('')).toEqual(items);
  });
  it('keeps category filtering active when a refreshed snapshot has no matching events', () => {
    const filters = { ...DEFAULT_EVENT_FILTERS, category: 'earthquake' };
    expect(filterWorldEvents([event({ category: 'earthquake' })], filters)).toHaveLength(1);
    expect(filterWorldEvents([event()], filters)).toEqual([]);
  });

});
