import { NextRequest, NextResponse } from 'next/server';
import {
  clearServerDebugEvents,
  getServerDebugEvents,
  serverDebugEnabled,
} from '@/lib/server-debug-store';

export const dynamic = 'force-dynamic';

function unavailable() {
  return NextResponse.json(
    { error: 'Server debug instrumentation is disabled' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(req: NextRequest) {
  if (!serverDebugEnabled()) return unavailable();

  const correlationId = req.nextUrl.searchParams.get('correlationId') || undefined;
  return NextResponse.json(
    { events: getServerDebugEvents(correlationId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function DELETE() {
  if (!serverDebugEnabled()) return unavailable();
  clearServerDebugEvents();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
