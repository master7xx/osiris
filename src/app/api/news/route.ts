import { NextResponse } from 'next/server';
import { getBreakingNews } from '@/lib/newsAggregator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { news, sources } = await getBreakingNews();
    const healthy = sources.filter(source => source.ok).length;
    return NextResponse.json({
      news,
      total: news.length,
      mapped: news.filter(item => item.coords).length,
      sources,
      source_summary: {
        healthy,
        total: sources.length,
        articles_before_dedupe: sources.reduce((sum, source) => sum + source.count, 0),
      },
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=90',
      },
    });
  } catch (error) {
    console.error('[OSIRIS] Breaking news aggregation failed:', error);
    return NextResponse.json({ news: [], sources: [], error: 'Failed to aggregate breaking news' }, { status: 502 });
  }
}
