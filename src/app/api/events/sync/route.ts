import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({ mode: process.env.EVENT_READ_MODE === 'durable' ? 'durable' : 'snapshot', version: 1 }, { headers: { 'Cache-Control': 'no-store' } });
}
