import { NextResponse } from 'next/server';
import { fetchGdeltEvents } from '@/lib/gdeltEvents';
import { getBreakingNews } from '@/lib/newsAggregator';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Map intelligence endpoint.
 *
 * Default mode now returns high-confidence geolocated breaking-news stories so
 * the existing gdelt-events MapLibre pipeline can act as the Breaking News
 * layer without a second renderer. `?mode=gdelt` preserves the raw GDELT 2.0
 * event export for operators and downstream callers that still need CAMEO data.
 */
const MAX_LIMIT = 2000;

function parseQuads(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(',').map(value => Number(value.trim())).filter(value => value >= 1 && value <= 4);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit')) || 600));

  if (searchParams.get('mode') === 'gdelt') {
    const quads = parseQuads(searchParams.get('quad'));
    const minArticles = Math.max(1, Number(searchParams.get('min_articles')) || 1);
    try {
      const { events, window, scanned } = await fetchGdeltEvents({ quads, minArticles, limit });
      return NextResponse.json({
        events,
        total: events.length,
        scanned,
        window,
        source: 'GDELT 2.0 Events',
        timestamp: new Date().toISOString(),
      }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
    } catch (error) {
      console.error('[OSIRIS] GDELT events fetch failed:', error);
      return NextResponse.json({ events: [], total: 0, error: 'Failed to fetch GDELT events' }, { status: 502 });
    }
  }

  try {
    const { news, sources } = await getBreakingNews();
    const mapped = news.filter(item => item.coords && !item.coords_default).slice(0, limit);
    const events = mapped.map(item => ({
      id: item.id,
      lat: item.coords![0],
      lng: item.coords![1],
      name: item.title,
      country: item.location || '',
      event_code: 'NEWS',
      root_code: 'NEWS',
      // Existing map renderer maps quad 2 to cyan/electric-blue — exactly the
      // visual language used by the Breaking News concept.
      quad: 2,
      quad_label: item.freshness === 'fresh' ? 'BREAKING NEWS · FRESH' : 'BREAKING NEWS',
      goldstein: 0,
      tone: item.risk_score,
      articles: Math.max(1, item.source_count),
      sources: item.source_count,
      url: item.link,
      date: item.published,
      age_minutes: item.age_minutes,
      freshness: item.freshness,
      source_names: item.sources,
      risk_score: item.risk_score,
    }));

    return NextResponse.json({
      events,
      total: events.length,
      source: 'OSIRIS Breaking News',
      source_health: sources,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=90' },
    });
  } catch (error) {
    console.error('[OSIRIS] Breaking-news map feed failed:', error);
    return NextResponse.json({ events: [], total: 0, error: 'Failed to fetch breaking-news map' }, { status: 502 });
  }
}
