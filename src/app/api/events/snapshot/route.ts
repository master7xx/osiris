import { NextResponse } from 'next/server';
import { getUnifiedEventFeed } from '@/lib/event-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Complete coherent checkpoint; UI applies its 300-card limit after filtering. */
export async function GET() {
  try {
    return NextResponse.json(await getUnifiedEventFeed(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Failed to load event snapshot' }, { status: 502 });
  }
}
