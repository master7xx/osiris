import { describe, expect, it } from 'vitest';
import { clusterArticles, locateArticle, normalizeHeadline, riskScore } from './newsAggregator';

describe('news aggregator', () => {
  it('normalizes breaking/update noise from headlines', () => {
    expect(normalizeHeadline('BREAKING: Latest missile strike in Kyiv — update')).toBe('missile strike in kyiv');
  });

  it('extracts high-confidence map locations', () => {
    expect(locateArticle('Missile strike reported near Kyiv overnight')).toEqual({
      coords: [50.4501, 30.5234],
      location: 'Kyiv, Ukraine',
    });
  });

  it('raises risk for tactical keywords', () => {
    expect(riskScore('ballistic missile attack and air defense intercept')).toBeGreaterThanOrEqual(8);
  });

  it('deduplicates similar headlines and preserves source corroboration', () => {
    const now = Date.parse('2026-09-09T00:30:00Z');
    const news = clusterArticles([
      {
        title: 'Missile strike reported near Kyiv overnight',
        description: 'Air defense active in Kyiv after missile attack.',
        link: 'https://example.com/a',
        published: '2026-09-09T00:20:00Z',
        source: 'BBC',
      },
      {
        title: 'Breaking: Missile strike reported near Kyiv',
        description: 'Missile attack reported in Kyiv.',
        link: 'https://example.com/b',
        published: '2026-09-09T00:18:00Z',
        source: 'The Guardian',
      },
    ], now);

    expect(news).toHaveLength(1);
    expect(news[0].source_count).toBe(2);
    expect(news[0].sources.sort()).toEqual(['BBC', 'The Guardian']);
    expect(news[0].freshness).toBe('fresh');
    expect(news[0].coords).toEqual([50.4501, 30.5234]);
  });
});
