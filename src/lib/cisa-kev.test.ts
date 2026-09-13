import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseKevCatalog, kevEvents, fetchKevCatalog, CISA_KEV_URL, type KevVulnerability } from './cisa-kev';
import { fuseEvents } from './event-fusion';
import { applyEventLedger, resetEventLedgerForTests } from './event-ledger';
import { collectorIdentities } from './collector-observations';
import { DEFAULT_EVENT_FILTERS, projectWorldEvents, isMappable } from './world-events-view';
import { collectSupplementalEventSignals } from './event-signals';

const now = Date.parse('2026-09-12T12:00:00Z');
const row = (cveID = 'CVE-2026-1234'): KevVulnerability => ({ cveID, vendorProject: 'Example', product: 'Server',
  vulnerabilityName: 'Example vulnerability', dateAdded: '2026-09-10', shortDescription: 'Example description',
  requiredAction: 'Apply vendor update', dueDate: '2026-10-01', knownRansomwareCampaignUse: 'Unknown' });
const catalog = (rows = [row()]) => ({ catalogVersion: '2026.09.12', dateReleased: '2026-09-12T00:00:00Z', count: rows.length, vulnerabilities: rows });
afterEach(() => { vi.unstubAllGlobals(); resetEventLedgerForTests(); });

describe('CISA KEV adapter', () => {
  it('preserves catalog provenance, day precision and remediation details without coordinates', () => {
    const [event] = kevEvents(parseKevCatalog(catalog()), now);
    expect(event.category).toBe('cyber');
    expect(event.occurred_at).toBe('2026-09-10T00:00:00.000Z');
    expect(event.tags).toContain('date-precision:day');
    expect(event.description).toContain('not the date of an attack');
    expect(event.description).toContain('Apply vendor update');
    expect(event.description).toContain('2026-10-01');
    expect(event.evidence[0]).toMatchObject({ source_id: 'cisa-kev', upstream_id: 'CVE-2026-1234', kind: 'official' });
    expect(event.lat).toBeUndefined(); expect(event.lng).toBeUndefined();
  });
  it('uses ransomware evidence without treating Unknown as No', () => {
    const events = kevEvents(catalog([row(), { ...row('CVE-2026-5678'), knownRansomwareCampaignUse: 'Known' }]), now);
    expect(events.map(event => event.severity)).toEqual([70, 80]);
    expect(events[0].description).toContain('Unknown');
    expect(events[1].tags).toContain('ransomware-use:known');
  });
  it('excludes stale and future additions without using the catalog release as event time', () => {
    expect(kevEvents(catalog([{ ...row(), dateAdded: '2026-08-01' }, { ...row('CVE-2026-5678'), dateAdded: '2026-09-13' }]), now)).toEqual([]);
  });
  it('does not inherit the legacy ten-entry limit', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`CVE-2026-${1234 + i}`));
    expect(kevEvents(catalog(rows), now)).toHaveLength(12);
  });
  it.each([{}, { ...catalog(), count: 99 }, catalog([row(), row()]), catalog([{ ...row(), dateAdded: '2026-02-31' }]),
    catalog([{ ...row(), cveID: 'bad' }]), catalog([{ ...row(), requiredAction: null } as unknown as KevVulnerability])])('rejects malformed or conflicting catalogs', data => {
    expect(() => parseKevCatalog(data)).toThrow();
  });
  it('keeps CVEs separate and revises one identity across 30 refresh/cache cycles', () => {
    let cached: ReturnType<typeof applyEventLedger>['events'] = [];
    let ids: string[] = [];
    for (let cycle = 0; cycle < 30; cycle++) {
      const at = now + cycle * 1000;
      const rows = [row(), row('CVE-2026-5678')];
      if (cycle > 0) rows[0].shortDescription = 'Corrected description';
      const fused = fuseEvents(kevEvents(catalog(rows), at), { now: at });
      expect(fused).toHaveLength(2);
      expect(new Set(fused.map(event => JSON.stringify(collectorIdentities(event)))).size).toBe(2);
      const latest = applyEventLedger(fused, at).events;
      const view = projectWorldEvents([...JSON.parse(JSON.stringify(cached)), ...latest], { ...DEFAULT_EVENT_FILTERS, category: 'cyber' }, at);
      expect(view.events).toHaveLength(2);
      expect(view.sources.map(source => source.source_id)).toEqual(['cisa-kev']);
      expect(view.events.some(isMappable)).toBe(false);
      const nextIds = view.events.map(event => event.id).sort();
      if (cycle) {
        expect(nextIds).toEqual(ids);
        expect(view.events.find(event => event.evidence[0].upstream_id === 'CVE-2026-1234')?.description).toContain('Corrected description');
      }
      ids = nextIds; cached = view.events;
      expect(projectWorldEvents(cached, { ...DEFAULT_EVENT_FILTERS, category: 'weather' }, at).events).toHaveLength(0);
    }
  });
  it('reports HTTP failure and a valid empty source distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === CISA_KEV_URL ? Response.json(catalog([])) : new Response('', { status: 503 })));
    const signals = await collectSupplementalEventSignals();
    expect(signals.health.find(source => source.id === 'cisa-kev')).toMatchObject({ ok: true, events: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(fetchKevCatalog()).rejects.toThrow('503');
    expect((await collectSupplementalEventSignals()).health.find(source => source.id === 'cisa-kev')).toMatchObject({ ok: false, state: 'error' });
  });
});
