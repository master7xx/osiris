import { cameraDiagnostics } from '@/lib/camera-diagnostics';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const ids = [...new Set(new URL(request.url).searchParams.getAll('id'))];
  if (!ids.length || ids.length > 8 || ids.some(id => id.length > 200)) return Response.json({ error: 'Expected 1–8 camera IDs' }, { status: 400 });
  const checks = await Promise.all(ids.map(async id => ({ id, ...await cameraDiagnostics.check(id) })));
  return Response.json({ checks }, { headers: { 'Cache-Control': 'no-store' } });
}
