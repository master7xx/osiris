import { NextResponse } from 'next/server';
import { getUnifiedEventFeed } from '@/lib/event-feed';
import type { EventCategory } from '@/lib/event-fusion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CATEGORIES = new Set<EventCategory>([
  'conflict', 'protest', 'political', 'earthquake', 'flood', 'wildfire', 'volcano',
  'weather', 'cyber', 'infrastructure', 'aviation', 'maritime', 'other',
]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedCategory = url.searchParams.get('category') as EventCategory | null;
    const category = requestedCategory && CATEGORIES.has(requestedCategory) ? requestedCategory : undefined;
    const minSeverityRaw = Number(url.searchParams.get('minSeverity') ?? '0');
    const minSeverity = Number.isFinite(minSeverityRaw) ? Math.max(0, Math.min(100, minSeverityRaw)) : 0;
    const limitRaw = Number(url.searchParams.get('limit') ?? '200');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, Math.round(limitRaw))) : 200;
    const mappableOnly = url.searchParams.get('mappable') === '1';

    const feed = await getUnifiedEventFeed();
    const events = feed.events
      .filter(event => !category || event.category === category)
      .filter(event => event.severity >= minSeverity)
      .filter(event => !mappableOnly || (typeof event.lat === 'number' && typeof event.lng === 'number' && event.location_confidence >= 0.75))
      .slice(0, limit);

    return NextResponse.json({
      ...feed,
      events,
      total: events.length,
      total_before_filter: feed.total,
      filters: {
        category: category ?? null,
        min_severity: minSeverity,
        mappable_only: mappableOnly,
        limit,
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('[OSIRIS] Unified event feed failed:', error);
    return NextResponse.json({
      events: [],
      total: 0,
      source_count: 0,
      healthy_sources: 0,
      source_health: [],
      error: 'Failed to build unified event feed',
    }, { status: 502 });
  }
}
