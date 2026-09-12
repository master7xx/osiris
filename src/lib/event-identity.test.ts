import { describe, expect, it } from 'vitest';
import { deduplicateReports } from './event-identity';
import { mergeSnapshotCache, validateClientCache, type EventClientCache } from './client-event-sync';
import { projectWorldEvents, DEFAULT_EVENT_FILTERS } from './world-events-view';
import type { ContinuousEvent } from './event-ledger';
import { __test, locateArticle } from './news-aggregator';

const now = Date.now();
const make = (id: string, url = 'https://t.me/istories_media/123', observed = now): ContinuousEvent => ({
  id, title: 'German investigators report Leipzig incident', description: 'Same source post', category: 'conflict',
  occurred_at: new Date(now - 60000).toISOString(), last_observed_at: new Date(observed).toISOString(),
  priority_score: 49, severity: 49, confidence: 'unconfirmed', sources: ['Important Stories'],
  evidence: [{ source_id: 'news:important-stories', source: 'Important Stories', url }],
} as ContinuousEvent);
const checkpoint = (events: ContinuousEvent[], time = now): EventClientCache => ({
  version: 1, mode: 'snapshot', savedAt: time,
  feed: { events, source_health: [], generated_at: new Date(time).toISOString(), total: events.length, mappable: 0, confirmed: 0, corroborating: 0, unconfirmed: events.length, categories: {}, source_count: 0, healthy_sources: 0, cursor: 0, new_events: 0, updated_events: 0, ongoing_events: events.length },
});

describe('repeated report reconciliation', () => {
  it('keeps one report across 100 refreshes, gaps, reloads and category switches', () => {
    let cache = checkpoint([make('legacy-1'), make('legacy-2', 'https://t.me/s/istories_media/123#anchor')]);
    for (let i = 0; i < 100; i++) {
      cache = mergeSnapshotCache(cache, checkpoint(i % 3 ? [make(`refresh-${i}`, undefined, now + i * 1000)] : [], now + i * 1000));
      cache = validateClientCache(JSON.parse(JSON.stringify(cache)))!;
      expect(cache).not.toBeNull();
      expect(cache.feed.events).toHaveLength(1);
      expect(projectWorldEvents(cache.feed.events, DEFAULT_EVENT_FILTERS, now).events).toHaveLength(1);
      expect(projectWorldEvents(cache.feed.events, { ...DEFAULT_EVENT_FILTERS, category: 'weather' }, now).events).toHaveLength(0);
      expect(projectWorldEvents(cache.feed.events, { ...DEFAULT_EVENT_FILTERS, category: 'conflict' }, now).events).toHaveLength(1);
    }
  });
  it('does not merge different posts with identical text', () => {
    expect(deduplicateReports([make('a'), make('b', 'https://t.me/istories_media/124')])).toHaveLength(2);
  });
  it('prefers the latest old-cache alias independent of array order', () => {
    const recent = make('recent', undefined, now + 1000), old = make('old');
    expect(deduplicateReports([recent, old])).toEqual([recent]);
    expect(deduplicateReports([old, recent])).toEqual([recent]);
  });
  it('uses stable article IDs when other stories change ranking', () => {
    const report = { title: 'Investigators report Leipzig incident', description: 'Report', link: 'https://t.me/istories_media/123', published: new Date(now).toISOString(), sourceId: 'important-stories', source: 'Important Stories', sourceTier: 'editorial' as const, sourceWeight: 1, independent: true };
    const other = { ...report, title: 'Central bank interest rate announcement', link: 'https://example.test/other', sourceWeight: 2 };
    const first = __test.clusterArticles([report], now).find(item => item.link === report.link)!;
    const second = __test.clusterArticles([other, report], now).find(item => item.link === report.link)!;
    expect(first.id).toBe(second.id);
  });
  it('does not find Aden inside Cyrillic words or Baden', () => {
    expect(locateArticle('Следователи сообщили о нападении в Лейпциге').location).toBe('Leipzig, Germany');
    expect(locateArticle('Investigators in Baden report findings').coords).toBeNull();
    expect(locateArticle('Aden port reports an incident').location).toBe('Aden, Yemen');
  });
});
