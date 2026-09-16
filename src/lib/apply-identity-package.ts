import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { checkIdentitySplitPackageInTransaction, validateIdentitySplitPackage } from './identity-split-package';
import { applyReviewedSplitInTransaction, splitReviewHash, splitPayloadHash, type ReviewedSplit } from './reviewed-event-split';
import { storedEventHash } from './durable-event-store';

function operationId(text: string) {
  const h = createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
interface Receipt {
  package_checksum: string; epoch: string; initial_cursor: string; final_cursor: string;
  groups: { parent_id: string; child_ids: string[]; cursor: string; observed_at: string[] }[];
}

/** All parents are replaced in a single transaction, including the durable receipt. */
export async function applyIdentityPackage(pool: Pool, value: unknown, approvedChecksum: string): Promise<Receipt> {
  const p = structuredClone(validateIdentitySplitPackage(value));
  if (p.checksum !== approvedChecksum) throw new Error('Explicit package checksum does not match');
  if (!p.data.splits.length || p.data.splits.length > 100) throw new Error('Package requires 1..100 splits');
  const parents = p.data.splits.map(s => s.parent_id);
  const targets = p.data.splits.flatMap(s => s.children.map(c => c.target));
  if (new Set(parents).size !== parents.length || new Set(targets).size !== targets.length ||
      p.data.excluded.some(g => parents.includes(g.parent_id))) throw new Error('Duplicate or excluded package members');
  const id = operationId(`package:${p.checksum}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    const meta = (await client.query('SELECT epoch,cursor FROM osiris_events.metadata WHERE singleton FOR UPDATE')).rows[0];
    if (!meta || meta.epoch !== p.data.epoch) throw new Error('Package epoch changed');
    const prior = (await client.query('SELECT input_hash,result FROM osiris_events.batches WHERE id=$1', [id])).rows[0];
    if (prior) {
      if (prior.input_hash !== `package:${p.checksum}`) throw new Error('Package operation reused');
      await client.query('COMMIT');
      return prior.result as Receipt;
    }
    // Prevent a new collector lease or source-row refresh between checks and writes.
    await client.query('LOCK TABLE osiris_events.collector,osiris_events.signals IN SHARE MODE');
    const check = await checkIdentitySplitPackageInTransaction(client, p);
    if (!check.database_matches_package) throw new Error('Package preconditions changed; run check');
    const receipt: Receipt = { package_checksum: p.checksum, epoch: p.data.epoch,
      initial_cursor: p.data.cursor, final_cursor: p.data.cursor, groups: [] };
    for (const [index, split] of p.data.splits.entries()) {
      const times = check.groups[index].children.map(c => c.observed_at);
      if (times.some(t => !t)) throw new Error('Verified observation time required');
      const plan: ReviewedSplit = { operation_id: operationId(`package:${p.checksum}:${split.parent_id}`),
        epoch: p.data.epoch, cursor: receipt.final_cursor, parent_id: split.parent_id,
        parent_revision: split.parent_revision, parent_payload_hash: split.parent_payload_hash,
        children: split.children.map((c, i) => ({ event: c.event, identities: c.identities, observed_at: times[i]! })) };
      const result = await applyReviewedSplitInTransaction(client, plan, splitReviewHash(plan));
      receipt.groups.push({ ...result, observed_at: times as string[] });
      receipt.final_cursor = result.cursor;
    }
    await client.query('INSERT INTO osiris_events.batches (id,input_hash,result) VALUES ($1,$2,$3)', [id, `package:${p.checksum}`, JSON.stringify(receipt)]);
    await client.query('COMMIT');
    return receipt;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Verify immediately after apply, before resuming collection. No mutations. */
export async function verifyIdentityPackage(pool: Pool, value: unknown) {
  const p = validateIdentitySplitPackage(value);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    const meta = (await client.query('SELECT epoch,cursor FROM osiris_events.metadata WHERE singleton')).rows[0];
    const row = (await client.query('SELECT input_hash,result FROM osiris_events.batches WHERE id=$1', [operationId(`package:${p.checksum}`)])).rows[0];
    if (!row || row.input_hash !== `package:${p.checksum}` || meta?.epoch !== p.data.epoch) throw new Error('Matching application receipt not found');
    const receipt = row.result as Receipt;
    const failures: string[] = [];
    if (String(meta.cursor) !== receipt.final_cursor) failures.push('cursor_advanced_after_apply');
    if (receipt.groups.length !== p.data.splits.length) failures.push('receipt_group_count');
    for (const split of p.data.splits) {
      const group = receipt.groups.find(g => g.parent_id === split.parent_id);
      if (!group || group.child_ids.length !== split.children.length) { failures.push(`receipt:${split.parent_id}`); continue; }
      const parent = (await client.query('SELECT revision,payload FROM osiris_events.events WHERE id=$1', [split.parent_id])).rows[0];
      if (!parent || String(parent.revision) !== (BigInt(split.parent_revision) + BigInt(1)).toString() ||
          JSON.stringify(parent.payload.replaced_by) !== JSON.stringify(group.child_ids)) failures.push(`parent:${split.parent_id}`);
      const old = (await client.query('SELECT payload FROM osiris_events.revisions WHERE event_id=$1 AND revision=$2', [split.parent_id, split.parent_revision])).rows[0];
      // Observation-only fields may change without a revision. Verify revision presence;
      // the exact current-parent hash was checked under lock before applying.
      if (!old) failures.push(`history:${split.parent_id}`);
      const replacement = (await client.query('SELECT payload FROM osiris_events.revisions WHERE event_id=$1 AND cursor=$2', [split.parent_id, group.cursor])).rows[0];
      if (!replacement || JSON.stringify(replacement.payload.replaced_by) !== JSON.stringify(group.child_ids)) failures.push(`replay:${split.parent_id}`);
      if ((await client.query('SELECT 1 FROM osiris_events.identities WHERE event_id=$1', [split.parent_id])).rowCount) failures.push(`parent_identities:${split.parent_id}`);
      for (const [i, child] of split.children.entries()) {
        const id = group.child_ids[i];
        const current = (await client.query('SELECT payload,last_observed_at FROM osiris_events.events WHERE id=$1', [id])).rows[0];
        const revision = (await client.query('SELECT payload FROM osiris_events.revisions WHERE event_id=$1 AND revision=1', [id])).rows[0];
        if (!current || storedEventHash(current.payload) !== storedEventHash({ ...child.event, id }) ||
            new Date(current.last_observed_at).toISOString() !== group.observed_at[i] || !revision ||
            splitPayloadHash(revision.payload) !== splitPayloadHash(current.payload)) failures.push(`child:${id}`);
        const actual = (await client.query('SELECT source_id,upstream_id FROM osiris_events.identities WHERE event_id=$1', [id])).rows.map(r => JSON.stringify([r.source_id, r.upstream_id])).sort();
        const expected = child.identities.map(r => JSON.stringify([r.sourceId, r.upstreamId])).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`identities:${id}`);
      }
    }
    await client.query('COMMIT');
    return { verified: failures.length === 0, failures, receipt, excluded_count: p.data.excluded.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
