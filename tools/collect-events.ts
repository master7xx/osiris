import { batches, observationIndex, collectorIdentities } from '../src/lib/collector-observations';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { collectEventSources } from '../src/lib/event-sources';
import { collectSupplementalEventSignals } from '../src/lib/event-signals';
import { fuseEvents, type IncomingEvent } from '../src/lib/event-fusion';
import { DurableEventStore, type EventWrite } from '../src/lib/durable-event-store';
import { acquireCollectorLease, releaseCollectorLease } from '../src/lib/event-collector-lease';

async function main() {
if (!process.env.EVENT_DATABASE_URL) throw new Error('EVENT_DATABASE_URL is required; run events:migrate first');
const pool = new pg.Pool({ connectionString: process.env.EVENT_DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
const store = new DurableEventStore(pool);
const owner = randomUUID();
const stop = new AbortController();
process.on('SIGINT', () => stop.abort()); process.on('SIGTERM', () => stop.abort());
let failures = 0;
try {
  while (!stop.signal.aborted) {
    const lease = await acquireCollectorLease(pool, owner).catch(error => { console.error('Lease acquisition failed:', error instanceof Error ? error.message : 'Database unavailable'); failures++; return null; });
    if (lease) {
      try {
        const [core, extra] = await Promise.all([collectEventSources(), collectSupplementalEventSignals()]);
        if (stop.signal.aborted) break;
        if (core.healthy_sources + extra.healthy_sources === 0) throw new Error('All event sources unavailable');
        // Persist successful observations; absent sources cannot erase prior signals.
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT cursor FROM osiris_events.metadata WHERE singleton FOR UPDATE');
          const ownership = (await client.query('SELECT 1 FROM osiris_events.collector WHERE owner=$1 AND generation=$2 AND expires_at>clock_timestamp()', [owner, lease.generation])).rows;
          if (!ownership.length) throw new Error('Collector lease expired');
          let storedSignals = 0;
          for (const signal of [...core.events, ...extra.events]) {
            if (storedSignals++ % 100 === 0) {
              const renewed = await client.query("UPDATE osiris_events.collector SET expires_at=clock_timestamp()+interval '120 seconds' WHERE owner=$1 AND generation=$2 AND expires_at>clock_timestamp()", [owner, lease.generation]);
              if (!renewed.rowCount) throw new Error('Collector lease expired');
            }
            await client.query(`INSERT INTO osiris_events.signals (id,payload) VALUES ($1,$2)
            ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,observed_at=clock_timestamp()`, [JSON.stringify([signal.evidence.map(item => item.source_id).sort(), signal.id]), JSON.stringify(signal)]);
          }
          await client.query("DELETE FROM osiris_events.signals WHERE observed_at < clock_timestamp()-interval '48 hours'");
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
        const signalRows = (await pool.query("SELECT payload,observed_at FROM osiris_events.signals WHERE observed_at>=clock_timestamp()-interval '48 hours'")).rows;
        const observedAt = observationIndex(signalRows);
        const signals = signalRows.map(row => row.payload as IncomingEvent);
        const fused = fuseEvents(signals, { now: Date.now(), limit: signals.length });
        const writes: EventWrite[] = [];
        const seen = new Set<string>();
        let conflicts = 0;
        let prepared = 0;
        for (const event of fused) {
          if (prepared++ % 100 === 0) {
            const renewed = await acquireCollectorLease(pool, owner);
            if (!renewed || renewed.generation !== lease.generation) throw new Error('Collector ownership changed');
          }
          const identities = collectorIdentities(event);
          const rows = (await pool.query(`SELECT DISTINCT e.id,e.revision FROM osiris_events.events e JOIN osiris_events.identities i ON i.event_id=e.id
            WHERE (i.source_id,i.upstream_id) IN (SELECT * FROM unnest($1::text[],$2::text[]))`, [identities.map(id => id.sourceId), identities.map(id => id.upstreamId)])).rows;
          if (rows.length > 1 || rows[0] && seen.has(rows[0].id)) { conflicts++; continue; }
          if (rows[0]) seen.add(rows[0].id);
          writes.push({ identities, event, observedAt: observedAt(event), expectedRevision: rows[0]?.revision ?? null });
        }
        if (!writes.length && conflicts) throw new Error('All candidates require identity reconciliation');
        for (const batch of batches(writes)) {
          const renewed = await acquireCollectorLease(pool, owner);
          if (!renewed || renewed.generation !== lease.generation) throw new Error('Collector ownership changed');
          await store.commitBatch(randomUUID(), batch, lease);
        }
        await pool.query('UPDATE osiris_events.collector SET last_success_at=clock_timestamp(),last_error=$4,source_health=$3 WHERE owner=$1 AND generation=$2', [owner, lease.generation, JSON.stringify([...core.health, ...extra.health]), conflicts ? `${conflicts} candidates skipped: identity reconciliation required` : null]);
        failures = 0; console.log(`Committed ${writes.length} events`);
      } catch (error) {
        failures++;
        const message = error instanceof Error ? error.message : 'Collection failed';
        console.error(message);
        await pool.query('UPDATE osiris_events.collector SET last_error=$3 WHERE owner=$1 AND generation=$2', [owner, lease.generation, message]).catch(() => {});
      } finally { await releaseCollectorLease(pool, lease).catch(() => {}); }
    }
    const wait = Math.min(90000 * 2 ** Math.min(failures, 4), 900000) + Math.floor(Math.random() * 5000);
    await delay(wait, undefined, { signal: stop.signal }).catch(() => {});
  }
} finally { await pool.end(); }

}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Collector failed"); process.exitCode = 1; });
