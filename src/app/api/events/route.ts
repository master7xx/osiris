import { NextResponse } from 'next/server';
import { getUnifiedEventFeed } from '@/lib/event-feed';
import type { EventLifecycle } from '@/lib/event-ledger';
import type { EventCategory } from '@/lib/event-fusion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CATEGORIES = new Set<EventCategory>([
  'conflict', 'protest', 'political', 'earthquake', 'flood', 'wildfire', 'volcano',
  'weather', 'cyber', 'infrastructure', 'aviation', 'maritime', 'other',
]);
const LIFECYCLES = new Set<EventLifecycle>(['new', 'updated', 'ongoing']);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedCategory = url.searchParams.get('category') as EventCategory | null;
    const category = requestedCategory && CATEGORIES.has(requestedCategory) ? requestedCategory : undefined;
    const requestedLifecycle = url.searchParams.get('lifecycle') as EventLifecycle | null;
    const lifecycle = requestedLifecycle && LIFECYCLES.has(requestedLifecycle) ? requestedLifecycle : undefined;
    const minSeverityRaw = Number(url.searchParams.get('minSeverity') ?? '0');
    const minSeverity = Number.isFinite(minSeverityRaw) ? Math.max(0, Math.min(100, minSeverityRaw)) : 0;
    const limitRaw = Number(url.searchParams.get('limit') ?? '200');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, Math.round(limitRaw))) : 200;
    const sinceRaw = Number(url.searchParams.get('since') ?? '0');
    const since = Number.isFinite(sinceRaw) ? Math.max(0, Math.floor(sinceRaw)) : 0;
    const mappableOnly = url.searchParams.get('mappable') === '1';

    const feed = await getUnifiedEventFeed();
    const events = feed.events
      .filter(event => !category || event.category === category)
      .filter(event => !lifecycle || event.lifecycle === lifecycle)
      .filter(event => event.severity >= minSeverity)
      .filter(event => event.change_sequence > since)
      .filter(event => !mappableOnly || (typeof event.lat === 'number' && typeof event.lng === 'number' && event.location_confidence >= 0.75))
      .slice(0, limit);

    return NextResponse.json({
      ...feed,
      events,
      total: events.length,
      total_before_filter: feed.total,
      cursor: feed.cursor,
      delta: since > 0,
      filters: {
        category: category ?? null,
        lifecycle: lifecycle ?? null,
        min_severity: minSeverity,
        since,
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
      cursor: 0,
      error: 'Failed to build unified event feed',
    }, { status: 502 });
  }
}
