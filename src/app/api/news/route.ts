import { NextResponse } from 'next/server';
import { aggregateNews } from '@/lib/news-aggregator';

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
    return NextResponse.json(
      {
        ...result,
        total: result.news.length,
        timestamp: new Date().toISOString(),
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
