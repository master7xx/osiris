import { describe, expect, it } from 'vitest';
import { __test, locateArticle } from './news-aggregator';

describe('news location extraction', () => {
  it('maps precise named places', () => {
    const hit = locateArticle('Missile strike reported near Kyiv overnight');
    expect(hit.location).toBe('Kyiv, Ukraine');
    expect(hit.coords).toEqual([50.4501, 30.5234]);
    expect(hit.confidence).toBeGreaterThan(0.9);
  });

  it('maps Cyrillic place names used by independent Russian-language feeds', () => {
    const hit = locateArticle('После ночной атаки в Киеве поврежден жилой дом');
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

  it('recognizes overlapping Cyrillic headlines', () => {
    expect(__test.similarity(
      'Ракетный удар по Киеву ночью повредил жилой дом',
      'Ночью ракетный удар по Киеву повредил жилой дом',
    )).toBeGreaterThan(0.6);
  });

  it('keeps unrelated stories separate', () => {
    expect(__test.similarity(
      'Missile strike reported near Kyiv overnight',
      'Taiwan central bank leaves rates unchanged',
    )).toBeLessThan(0.3);
  });
});

describe('news source policy', () => {
  it('includes the refreshed independent editorial Telegram tier', () => {
    const ids = __test.sources.map(source => source.id);
    expect(ids).toEqual(expect.arrayContaining([
      'astra',
      'meduza',
      'important-stories',
      'the-insider',
      'novaya-europe',
    ]));

    for (const id of ['astra', 'meduza', 'important-stories', 'the-insider', 'novaya-europe']) {
      const source = __test.sources.find(item => item.id === id);
      expect(source?.tier).toBe('editorial');
      expect(source?.independent).toBe(true);
      expect(source?.maxItems).toBeLessThanOrEqual(8);
    }
  });

  it('scores Cyrillic conflict signals as elevated', () => {
    expect(__test.scoreRisk('Ракетный удар и взрыв после атаки беспилотника')).toBeGreaterThanOrEqual(5);
  });
});
