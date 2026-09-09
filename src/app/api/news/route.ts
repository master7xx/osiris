import { NextResponse } from 'next/server';
import { aggregateNews } from '@/lib/news-aggregator';
import { getSourceHealthSnapshot, noteSourceFreshness } from '@/lib/news-source-health';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS breaking-news API.
 *
 * Conventional RSS and fast Telegram/OSINT sources are collected in parallel.
 * The aggregator removes stale stories, clusters near-duplicates, records
 * source health, and only assigns map coordinates when location confidence is
 * high enough to avoid misleading points on the globe.
 */
export async function GET() {
  try {
    const result = await aggregateNews();
    const now = Date.now();

    // Freshness is evaluated from stories that survived the aggregator's live
    // 24-hour window. A transport failure does not also count as a stale cycle;
    // the reliability model already accounts for that separately.
    for (const source of result.health) {
      if (!source.ok || source.skipped) continue;
      const stories = result.news.filter(story =>
        story.source === source.name || story.sources?.includes(source.name),
      );
      const newestItemAt = stories.reduce((latest, story) => {
        const published = Date.parse(story.published);
        return Number.isFinite(published) ? Math.max(latest, published) : latest;
      }, 0);
      noteSourceFreshness(source.id, stories.length, newestItemAt || undefined, now);
    }

    const health = result.health.map(source => ({
      ...source,
      ...getSourceHealthSnapshot(source.id, source.weight, now),
    }));

    return NextResponse.json(
      {
        ...result,
        health,
        healthy_sources: health.filter(source => source.state === 'healthy').length,
        degraded_sources: health.filter(source => source.state === 'degraded').length,
        cooldown_sources: health.filter(source => source.state === 'cooldown').length,
        total: result.news.length,
        timestamp: new Date(now).toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (error) {
    console.error('[OSIRIS] News aggregation failed:', error);
    return NextResponse.json(
      { news: [], total: 0, source_count: 0, healthy_sources: 0, health: [], error: 'Failed to fetch news' },
      { status: 502 },
    );
  }
}
