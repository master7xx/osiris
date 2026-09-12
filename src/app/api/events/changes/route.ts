import { NextResponse } from 'next/server';
import { eventDatabase } from '@/lib/event-database';
import { CursorResetRequired, DurableEventReader } from '@/lib/durable-event-reader';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const pool = eventDatabase();
  if (!pool) return NextResponse.json({ error: 'Durable store is not configured' }, { status: 503 });
  const params = new URL(request.url).searchParams;
  try { return NextResponse.json(await new DurableEventReader(pool).changes(params.get('cursor') ?? undefined, Number(params.get('limit') ?? 100)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return NextResponse.json({ error: error instanceof CursorResetRequired ? error.message : 'Durable store unavailable', reset_required: error instanceof CursorResetRequired }, { status: error instanceof CursorResetRequired ? 410 : 503 }); }
}
