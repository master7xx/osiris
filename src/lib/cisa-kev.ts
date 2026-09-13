import type { IncomingEvent } from './event-fusion';

export const CISA_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const CISA_KEV_CATALOG = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog';
export interface KevVulnerability {
  cveID: string; vendorProject: string; product: string; vulnerabilityName: string;
  dateAdded: string; shortDescription: string; requiredAction: string; dueDate: string;
  knownRansomwareCampaignUse?: string; notes?: string;
}
export interface KevCatalog {
  catalogVersion: string; dateReleased: string; count: number; vulnerabilities: KevVulnerability[];
}
function dateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function parseKevCatalog(payload: unknown): KevCatalog {
  const data = payload as KevCatalog | null;
  if (!data || !Array.isArray(data.vulnerabilities) || typeof data.catalogVersion !== 'string'
    || typeof data.dateReleased !== 'string' || !Number.isFinite(Date.parse(data.dateReleased))
    || !Number.isInteger(data.count) || data.count !== data.vulnerabilities.length) throw new Error('Invalid CISA KEV catalog');
  const ids = new Set<string>();
  for (const row of data.vulnerabilities) {
    if (!row || !['cveID', 'vendorProject', 'product', 'vulnerabilityName', 'shortDescription', 'requiredAction'].every(key =>
      typeof row[key as keyof KevVulnerability] === 'string') || !/^CVE-\d{4}-\d{4,19}$/.test(row.cveID)
      || !dateOnly(row.dateAdded) || !dateOnly(row.dueDate)
      || row.notes !== undefined && typeof row.notes !== 'string'
      || row.knownRansomwareCampaignUse !== undefined && typeof row.knownRansomwareCampaignUse !== 'string'
      || ids.has(row.cveID)) throw new Error('Invalid or duplicate CISA KEV entry');
    ids.add(row.cveID);
  }
  return data;
}
export async function fetchKevCatalog(): Promise<KevCatalog> {
  const response = await fetch(CISA_KEV_URL, {
    signal: AbortSignal.timeout(15000), cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`CISA KEV HTTP ${response.status}`);
  return parseKevCatalog(await response.json());
}
export function recentKevEntries(catalog: KevCatalog, now = Date.now()): KevVulnerability[] {
  return catalog.vulnerabilities.filter(row => {
    const added = Date.parse(`${row.dateAdded}T00:00:00Z`);
    return added <= now && now - added <= 30 * 86400000;
  }).sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || a.cveID.localeCompare(b.cveID));
}
export function kevEvents(catalog: KevCatalog, now = Date.now()): IncomingEvent[] {
  return recentKevEntries(catalog, now).map(row => {
    const published = `${row.dateAdded}T00:00:00.000Z`;
    const ransomware = row.knownRansomwareCampaignUse === 'Known';
    return {
      id: `cisa-kev:${row.cveID}`, category: 'cyber',
      title: `CISA KEV addition · ${row.cveID} · ${row.vulnerabilityName}`,
      description: [
        `Catalog addition: ${row.dateAdded} (date only; not the date of an attack).`,
        `Affected product: ${row.vendorProject} / ${row.product}.`, row.shortDescription,
        `CISA required action: ${row.requiredAction}`, `CISA due date: ${row.dueDate}.`,
        `Ransomware campaign use: ${row.knownRansomwareCampaignUse || 'Unknown'}.`, row.notes,
      ].filter(Boolean).join('\n\n'),
      occurred_at: published, discovered_at: new Date(now).toISOString(),
      location_confidence: 0, severity: ransomware ? 80 : 70,
      evidence: [{ source_id: 'cisa-kev', source: 'CISA KEV', kind: 'official', independent: true,
        weight: 1.2, upstream_id: row.cveID, url: CISA_KEV_CATALOG, published_at: published }],
      tags: ['cisa-kev', 'vulnerability-advisory', 'date-precision:day', row.cveID, ...(ransomware ? ['ransomware-use:known'] : [])],
    };
  });
}
export async function fetchKevEvents(): Promise<IncomingEvent[]> {
  return kevEvents(await fetchKevCatalog());
}
