import { NextResponse } from 'next/server';
import { getUnifiedEventFeed } from '@/lib/event-feed';
import { CONFLICT_ZONES, projectUnifiedConflicts } from '@/lib/conflict-projection';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Legacy conflict-zone compatibility API backed by the unified event feed.
 *
 * The previous implementation independently fetched a few RSS feeds, matched
 * them against hard-coded zone keywords and then fabricated small coordinate
 * offsets around each zone anchor. That created a second event pipeline and
 * made approximate points look like observed locations.
 *
 * Keep the response contract (`zones` + `liveEvents`) for existing consumers,
 * but source all events from the shared fusion engine. Zone anchors are now
 * context only; live markers require sufficiently confident real coordinates.
 */
export async function GET() {
  const now = Date.now();
  try {
    const feed = await getUnifiedEventFeed();
    const { zones, liveEvents } = projectUnifiedConflicts(feed.events, now);

    return NextResponse.json({
      zones,
      liveEvents,
      totalZones: zones.length,
      totalLiveEvents: liveEvents.length,
      activeWarzones: zones.filter(zone => zone.severity === 'war').length,
      timestamp: new Date(now).toISOString(),
      sources: ['Unified Event Fusion'],
      source_count: feed.source_count,
      healthy_sources: feed.healthy_sources,
      source_health: feed.source_health,
      refreshInterval: 60,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=90',
      },
    });
  } catch (error) {
    console.error('[OSIRIS] Conflict compatibility projection failed:', error);
    const { zones } = projectUnifiedConflicts([], now);

    // Preserve the historical fail-soft contract: contextual zones remain
    // available even if every live upstream is temporarily unavailable.
    return NextResponse.json({
      zones,
      liveEvents: [],
      totalZones: CONFLICT_ZONES.length,
      totalLiveEvents: 0,
      activeWarzones: CONFLICT_ZONES.filter(zone => zone.severity === 'war').length,
      timestamp: new Date(now).toISOString(),
      sources: ['Unified Event Fusion (fallback)'],
      source_count: 0,
      healthy_sources: 0,
      source_health: [],
      refreshInterval: 60,
      error: 'Unified event feed temporarily unavailable',
    }, {
      headers: { 'Cache-Control': 'no-cache' },
    });
  }
}
