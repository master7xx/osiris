import { expect, it, vi } from 'vitest';
import { GET } from './route';
import { getUnifiedEventFeed } from '@/lib/event-feed';
vi.mock('@/lib/event-feed', () => ({ getUnifiedEventFeed: vi.fn() }));
it('returns the complete checkpoint beyond the card limit', async () => {
  const events = Array.from({ length: 301 }, (_, i) => ({ id: String(i) }));
  vi.mocked(getUnifiedEventFeed).mockResolvedValue({ events, generated_at: '2026-09-12T00:00:00Z' } as Awaited<ReturnType<typeof getUnifiedEventFeed>>);
  const response = await GET();
  expect((await response.json()).events).toHaveLength(301);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('returns an error instead of an empty successful checkpoint on failure', async () => {
  vi.mocked(getUnifiedEventFeed).mockRejectedValue(new Error('offline'));
  expect((await GET()).status).toBe(502);
});
