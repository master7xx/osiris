import { describe, expect, it } from 'vitest';
import { __test, locateArticle } from './news-aggregator';

describe('news location extraction', () => {
  it('maps precise named places', () => {
    const hit = locateArticle('Missile strike reported near Kyiv overnight');
    expect(hit.location).toBe('Kyiv, Ukraine');
    expect(hit.coords).toEqual([50.4501, 30.5234]);
    expect(hit.confidence).toBeGreaterThan(0.9);
  });

  it('does not invent coordinates for unknown text', () => {
    expect(locateArticle('Markets react to a new policy announcement').coords).toBeNull();
  });
});

describe('news clustering', () => {
  it('recognizes strongly overlapping headlines', () => {
    expect(__test.similarity(
      'Missile strike reported near Kyiv overnight',
      'Kyiv hit by overnight missile strike, officials report',
    )).toBeGreaterThan(0.5);
  });

  it('keeps unrelated stories separate', () => {
    expect(__test.similarity(
      'Missile strike reported near Kyiv overnight',
      'Taiwan central bank leaves rates unchanged',
    )).toBeLessThan(0.3);
  });
});
