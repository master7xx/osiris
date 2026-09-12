import type { Pool } from 'pg';

export class CursorResetRequired extends Error {}
interface Cursor { epoch: string; after: string; through: string | null }
const encode = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(token: string): Cursor {
  try {
    if (token.length > 512) throw new Error();
    const cursor = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (typeof cursor.epoch !== 'string' || typeof cursor.after !== 'string' || !/^\d+$/.test(cursor.after)
      || !(cursor.through === null || typeof cursor.through === 'string' && /^\d+$/.test(cursor.through))) throw new Error();
    return cursor;
  } catch { throw new CursorResetRequired('Invalid cursor; bootstrap required'); }
}

export class DurableEventReader {
  constructor(private readonly pool: Pool) {}
  /** A single repeatable-read snapshot pairs all current events with a replay cursor. */
  async bootstrap() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const meta = (await client.query('SELECT epoch,cursor FROM osiris_events.metadata WHERE singleton')).rows[0];
      if (!meta) throw new Error('Event store requires migration');
      const events = (await client.query('SELECT e.id,e.revision,e.cursor,e.payload,e.first_observed_at,e.last_observed_at,r.committed_at AS changed_at FROM osiris_events.events e JOIN osiris_events.revisions r ON r.cursor=e.cursor ORDER BY e.cursor')).rows;
      const collector = (await client.query('SELECT expires_at,last_success_at,last_error,source_health FROM osiris_events.collector WHERE singleton')).rows[0] ?? null;
      await client.query('COMMIT');
      return { collector, events, cursor: encode({ epoch: meta.epoch, after: meta.cursor, through: null }) };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async changes(token?: string, requestedLimit = 100) {
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(300, Math.floor(requestedLimit))) : 100;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const meta = (await client.query('SELECT epoch,cursor,retention_floor FROM osiris_events.metadata WHERE singleton')).rows[0];
      if (!meta) throw new Error('Event store requires migration');
      const cursor = token ? decode(token) : { epoch: meta.epoch, after: '0', through: null };
      const through = cursor.through ?? meta.cursor;
      if (cursor.epoch !== meta.epoch || BigInt(cursor.after) < BigInt(meta.retention_floor)
        || BigInt(cursor.after) > BigInt(through) || BigInt(through) > BigInt(meta.cursor)) throw new CursorResetRequired('Cursor expired or store changed; bootstrap required');
      const rows = (await client.query('SELECT cursor,event_id,revision,payload,committed_at FROM osiris_events.revisions WHERE cursor>$1 AND cursor<=$2 ORDER BY cursor LIMIT $3', [cursor.after, through, limit + 1])).rows;
      const more = rows.length > limit;
      const changes = rows.slice(0, limit);
      const next = encode({ epoch: meta.epoch, after: more ? changes[changes.length - 1].cursor : through, through: more ? through : null });
      const collector = (await client.query('SELECT last_success_at,last_error,source_health FROM osiris_events.collector WHERE singleton')).rows[0] ?? null;
      const observations = more ? [] : (await client.query("SELECT id,last_observed_at,payload->'priority_score' AS priority_score FROM osiris_events.events")).rows;
      await client.query('COMMIT');
      return { observations, collector, changes, cursor: next, has_more: more, through };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
