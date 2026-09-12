import { describe, expect, it } from 'vitest';
import { formatEventText, isNewsDigest } from './event-text';
import { newsToEvent } from './event-sources';
import { isMappable } from './world-events-view';
import { shouldFuseEvents } from './event-fusion';
import type { NewsItem } from './news-aggregator';
import type { ContinuousEvent } from './event-ledger';

const description = 'Главное за 12 сентября — коротко #водномпосте ♦ В Одессе продолжаются работы. ♦ В Петербурге дефицит бензина.';
const news: NewsItem = { id: 'roundup', title: 'Удар по жилому дому, реорганизация ФСБ.', description,
  link: 'https://t.me/example/1', published: '2026-09-12T14:40:10Z', source: 'Novaya Gazeta Europe', sources: ['Novaya Gazeta Europe'],
  source_count: 1, independent_sources: 1, editorial_sources: 1, evidence_weight: 1, risk_score: 4, confidence: 'low',
  coords: [59.9, 30.3], location: 'St Petersburg, Russia', location_confidence: 0.98, age_minutes: 1, machine_assessment: null };

describe('digest text and map safety', () => {
  it('recognizes explicit roundups but does not equate long or bulleted reports with digests', () => {
    expect(isNewsDigest(news.title, description)).toBe(true);
    expect(isNewsDigest('Daily briefing', '• First report\n• Second report')).toBe(true);
    expect(isNewsDigest('Earthquake update', '• Depth 10 km\n• Magnitude 6')).toBe(false);
    expect(isNewsDigest('A long report', 'Details. '.repeat(100))).toBe(false);
  });
  it('keeps source text readable without introducing HTML', () => {
    expect(formatEventText('First paragraph\r\n\r\nSecond ♦ Item one ♦ Item two')).toBe('First paragraph\n\nSecond\n\n♦ Item one\n\n♦ Item two');
    expect(formatEventText('<script>text</script>')).toBe('<script>text</script>');
  });
  it('removes the single place from ingested digests and rejects old cached coordinates', () => {
    const digest = newsToEvent(news);
    expect(digest.tags).toContain('digest');
    expect(digest.lat).toBeUndefined(); expect(digest.location).toBeUndefined();
    expect(digest.location_confidence).toBe(0);
    expect(isMappable({ ...digest, lat: 59.9, lng: 30.3, location_confidence: 0.98, tags: [] } as unknown as ContinuousEvent)).toBe(false);
    const single = newsToEvent({ ...news, description: 'A single report about St Petersburg.' });
    expect(single.lat).toBe(59.9);
    expect(shouldFuseEvents(digest, single)).toBe(false);
  });
});
