import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { fuseEvents } from './event-fusion';
import { collectorIdentities } from './collector-observations';
import { identitySnapshotInputs, replayIdentitySnapshot } from './identity-reconciliation-snapshot';
import { splitPayloadHash } from './reviewed-event-split';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identityKey = (id: { sourceId: string; upstreamId: string }) => JSON.stringify([id.sourceId, id.upstreamId]);
const fingerprint = (source: string, id: string) => createHash('sha256').update(JSON.stringify([source, id])).digest('hex');

/** Concrete review document only. Does not create operation IDs or call the mutation primitive. */
export function buildIdentitySplitPackage(snapshot: unknown) {
  const review = replayIdentitySnapshot(snapshot);
  const original = identitySnapshotInputs(snapshot);
  const data = original.snapshotData!;
  const splits = review.reconciliation.groups.filter(g => g.action === 'propose_split_for_review').map(group => {
    const parent = data.events.find(e => e.id === group.stored_event_id);
    if (!parent || parent.payload.replaced_by?.length) throw new Error('Parent unavailable or already replaced');
    const links = data.links.filter(link => link.event_id === group.stored_event_id);
    const children = group.partitions.map(partition => {
      const id = partition.source === 'gdacs' ? `gdacs:${partition.provider_event_id}` : `usgs:${partition.provider_event_id}`;
      const signals = data.signals.filter(s => s.id === id);
      const events = fuseEvents(signals, { now: Date.parse(String(original.sampled_at)), limit: 2 });
      if (events.length !== 1) throw new Error('Partition must produce exactly one event');
      const identities = links.filter(l => partition.identity_fingerprints.includes(fingerprint(l.source_id, l.upstream_id)))
        .map(l => ({ sourceId: l.source_id, upstreamId: l.upstream_id })).sort((a, b) => identityKey(a).localeCompare(identityKey(b)));
      const evidenceKeys = [...new Set(collectorIdentities(events[0]).map(identityKey))].sort();
      if (!identities.length || JSON.stringify(evidenceKeys) !== JSON.stringify(identities.map(identityKey).sort())) throw new Error('Partition evidence does not cover exact stored identities');
      return { target: partition.proposed_target, source: partition.source, provider_event_id: partition.provider_event_id,
        event: { ...events[0], id: partition.proposed_target }, identities,
        // discovery time is not a reliable substitute for a persisted source observation.
        observed_at: null };
    });
    const keys = children.flatMap(c => c.identities.map(identityKey)).sort();
    if (new Set(keys).size !== keys.length || JSON.stringify(keys) !== JSON.stringify(links.map(l => JSON.stringify([l.source_id, l.upstream_id])).sort())) throw new Error('Incomplete or overlapping partitions');
    return { parent_id: group.stored_event_id, parent_revision: group.expected_revision,
      parent_payload_hash: splitPayloadHash(parent.payload), parent_title: parent.title,
      children, history_action: 'preserve_parent_history_and_record_replacement' };
  });
  const dataOut = { format: 'identity-split-package-v1', executable: false, snapshot_checksum: review.snapshot_checksum,
    algorithm: review.algorithm, sampled_at: original.sampled_at, epoch: review.reconciliation.epoch, cursor: String(original.cursor),
    splits, excluded: review.reconciliation.groups.filter(g => g.action !== 'propose_split_for_review')
      .map(g => ({ parent_id: g.stored_event_id, blockers: g.blockers })),
    unresolved_event_ids: review.reconciliation.unresolved_event_ids,
    application_requirements: ['semantic_review', 'verified_source_observation_times', 'fresh_transactional_preconditions'] };
  return { data: dataOut, checksum: hash(dataOut) };
}
export type IdentitySplitPackage = ReturnType<typeof buildIdentitySplitPackage>;
export function validateIdentitySplitPackage(value: unknown): IdentitySplitPackage {
  const p = value as IdentitySplitPackage;
  if (!p?.data || p.data.format !== 'identity-split-package-v1' || p.data.executable !== false || hash(p.data) !== p.checksum ||
      !Array.isArray(p.data.splits) || p.data.splits.length > 10000) throw new Error('Invalid split package');
  return p;
}

/** Read-only point-in-time check. Actual application must repeat checks under writer locks. */
export async function checkIdentitySplitPackage(pool: Pool, value: unknown) {
  const p = validateIdentitySplitPackage(value);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const meta = (await client.query('SELECT epoch,cursor FROM osiris_events.metadata WHERE singleton')).rows[0];
    const collectorActive = !!(await client.query('SELECT 1 FROM osiris_events.collector WHERE expires_at>clock_timestamp()')).rowCount;
    const ids = p.data.splits.map(s => s.parent_id);
    const parents = (await client.query('SELECT id,revision,payload FROM osiris_events.events WHERE id=ANY($1::uuid[])', [ids])).rows;
    const links = (await client.query('SELECT event_id,source_id,upstream_id FROM osiris_events.identities WHERE event_id=ANY($1::uuid[])', [ids])).rows;
    const globalBlockers: string[] = [];
    if (!meta || meta.epoch !== p.data.epoch || String(meta.cursor) !== p.data.cursor) globalBlockers.push('snapshot_changed');
    if (collectorActive) globalBlockers.push('collector_lease_active');
    const groups = p.data.splits.map(split => {
      const parent = parents.find(row => row.id === split.parent_id);
      const blockers = [...globalBlockers];
      if (!parent || String(parent.revision) !== split.parent_revision || splitPayloadHash(parent.payload) !== split.parent_payload_hash || parent.payload.replaced_by?.length) blockers.push('parent_changed');
      const actual = links.filter(l => l.event_id === split.parent_id).map(l => JSON.stringify([l.source_id, l.upstream_id])).sort();
      const expected = split.children.flatMap(c => c.identities.map(identityKey)).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) blockers.push('identities_changed');
      return { parent_id: split.parent_id, parent_title: split.parent_title, blockers,
        children: split.children.map(c => ({ target: c.target, source: c.source, provider_event_id: c.provider_event_id,
          title: c.event.title, occurred_at: c.event.occurred_at, lat: c.event.lat ?? null, lng: c.event.lng ?? null,
          identity_count: c.identities.length })) };
    });
    await client.query('COMMIT');
    return { mode: 'read-only-preflight', executable: false, package_checksum: p.checksum,
      snapshot_checksum: p.data.snapshot_checksum, database_matches_package: !globalBlockers.length && groups.every(g => !g.blockers.length),
      global_blockers: globalBlockers, groups, excluded: p.data.excluded, unresolved_event_ids: p.data.unresolved_event_ids,
      application_requirements: p.data.application_requirements,
      notes: ['A matching database is not semantic approval. No data was modified.',
        'No source observation timestamps were inferred from discovery time.',
        'Each applied split advances the cursor; this package cannot be applied as independent unchanged-cursor operations.'] };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
