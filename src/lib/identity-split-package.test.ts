import { expect, it } from 'vitest';
import { createIdentitySnapshot } from './identity-reconciliation-snapshot';
import { buildIdentitySplitPackage, validateIdentitySplitPackage } from './identity-split-package';

function fixture(near = false, extraEvidence = false) {
  const signals = [0, 1].map(i => ({ id: `usgs:${i}`, title: `Earthquake ${i}`, category: 'earthquake',
    occurred_at: '2026-09-15T00:00:00Z', lat: near ? 0 : i * 40, lng: 0, severity: 40,
    evidence: [{ source_id: 'usgs-earthquakes', source: 'USGS', kind: 'sensor', independent: true, weight: 1, url: `url-${i}` },
      ...(extraEvidence ? [{ source_id: 'other', source: 'Other', kind: 'sensor', independent: true, weight: 1, url: 'unlinked' }] : [])] }));
  return createIdentitySnapshot({ sampled_at: '2026-09-16T00:00:00Z', cursor: '1',
    reconciliation: { epoch: 'epoch', groups: [], notes: [], executable: false },
    snapshotData: { signals, links: [0, 1].map(i => ({ source_id: 'usgs-earthquakes', upstream_id: `url-${i}`, event_id: 'parent', revision: '1' })),
      events: [{ id: 'parent', title: 'Old combined event', payload: { title: 'Old combined event' } }], history: [], requested_event_ids: ['parent'] },
  } as unknown as Parameters<typeof createIdentitySnapshot>[0]);
}
it('builds concrete disjoint children deterministically without invented observation times', () => {
  const snapshot = fixture();
  const p = buildIdentitySplitPackage(snapshot);
  expect(buildIdentitySplitPackage(JSON.parse(JSON.stringify(snapshot)))).toEqual(p);
  expect(p.data.splits[0].children.map(c => c.event.title)).toEqual(['Earthquake 0', 'Earthquake 1']);
  expect(p.data.splits[0].children.every(c => c.observed_at === null && c.identities.length === 1)).toBe(true);
  expect(p.data.executable).toBe(false);
  expect(validateIdentitySplitPackage(p)).toEqual(p);
});
it('excludes blocked groups and rejects extra unassigned evidence', () => {
  expect(buildIdentitySplitPackage(fixture(true)).data.splits).toEqual([]);
  expect(buildIdentitySplitPackage(fixture(true)).data.excluded).toHaveLength(1);
  expect(() => buildIdentitySplitPackage(fixture(false, true))).toThrow('evidence');
});
it('rejects modified package contents', () => {
  const p = buildIdentitySplitPackage(fixture());
  p.data.splits[0].children[0].event.title = 'changed';
  expect(() => validateIdentitySplitPackage(p)).toThrow();
});
