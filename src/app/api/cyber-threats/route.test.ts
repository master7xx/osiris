import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { CISA_KEV_URL } from '@/lib/cisa-kev';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('preserves legacy fields and limits only the legacy view to ten newest entries', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
  const vulnerabilities = Array.from({ length: 12 }, (_, i) => ({ cveID: `CVE-2026-${1234 + i}`,
    vendorProject: 'Example', product: 'Server', vulnerabilityName: 'Example vulnerability',
    dateAdded: `2026-09-${String(i + 1).padStart(2, '0')}`, dueDate: '2026-10-01', shortDescription: 'Description', requiredAction: 'Update' }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === CISA_KEV_URL
    ? { catalogVersion: '1', dateReleased: '2026-09-12T00:00:00Z', count: 12, vulnerabilities } : {})));
  const response = await GET(); const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.threats).toHaveLength(10);
  expect(body.threats[0]).toMatchObject({ id: 'CVE-2026-1245', vendor: 'Example', product: 'Server', source: 'CISA KEV', date: '2026-09-12' });
  expect(body.stats).toMatchObject({ cisa_total: 12, active_cves: 10 });
});
