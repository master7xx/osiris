import { NextResponse } from 'next/server';
import { eventDatabase } from '@/lib/event-database';
import { DurableEventReader } from '@/lib/durable-event-reader';
export const dynamic = 'force-dynamic';
export async function GET() {
  const pool = eventDatabase();
  if (!pool) return NextResponse.json({ error: 'Durable store is not configured' }, { status: 503 });
  try { return NextResponse.json(await new DurableEventReader(pool).bootstrap(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Durable store unavailable' }, { status: 503 }); }
}
