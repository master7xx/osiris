import { persistCollectorSignals } from '../src/lib/collector-signal-store';
import { lookupCollectorIdentities } from '../src/lib/collector-identity-lookup';
import { recordCollectorOutcome } from '../src/lib/collector-outcome';
import type { EventSourceHealth } from '../src/lib/event-sources';
import { batches, observationIndex, collectorIdentities } from '../src/lib/collector-observations';
import { randomUUID } from 'node:crypto';
import { createEventDatabasePool } from '../src/lib/event-database-pool';
import { setTimeout as delay } from 'node:timers/promises';
import { collectEventSources } from '../src/lib/event-sources';
import { collectSupplementalEventSignals } from '../src/lib/event-signals';
import { fuseEvents, type IncomingEvent } from '../src/lib/event-fusion';
import { DurableEventStore, type EventWrite } from '../src/lib/durable-event-store';
import { acquireCollectorLease, releaseCollectorLease } from '../src/lib/event-collector-lease';

async function main() {
if (!process.env.EVENT_DATABASE_URL) throw new Error('EVENT_DATABASE_URL is required; run events:migrate first');
const pool = createEventDatabasePool({ connectionString: process.env.EVENT_DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, statement_timeout: 30000 }, 'collector');
const store = new DurableEventStore(pool);
const owner = randomUUID();
const stop = new AbortController();
process.on('SIGINT', () => stop.abort()); process.on('SIGTERM', () => stop.abort());
let failures = 0;
try {
  while (!stop.signal.aborted) {
    const lease = await acquireCollectorLease(pool, owner).catch(error => { console.error('Lease acquisition failed:', error instanceof Error ? error.message : 'Database unavailable'); failures++; return null; });
    if (lease) {
      let sourceHealth: EventSourceHealth[] | undefined;
      try {
        const [core, extra] = await Promise.all([collectEventSources(), collectSupplementalEventSignals()]);
        sourceHealth = [...core.health, ...extra.health];
        if (stop.signal.aborted) break;
        if (core.healthy_sources + extra.healthy_sources === 0) throw new Error('All event sources unavailable');
        // Persist successful observations; absent sources cannot erase prior signals.
        await persistCollectorSignals(pool, lease, [...core.events, ...extra.events]);
        const signalRows = (await pool.query("SELECT payload,observed_at FROM osiris_events.signals WHERE observed_at>=clock_timestamp()-interval '48 hours'")).rows;
        const observedAt = observationIndex(signalRows);
        const signals = signalRows.map(row => row.payload as IncomingEvent);
        const fused = fuseEvents(signals, { now: Date.now(), limit: signals.length });
        const identityGroups = fused.map(collectorIdentities);
        const storedMatches = await lookupCollectorIdentities(pool, identityGroups, async () => {
          const renewed = await acquireCollectorLease(pool, owner);
          if (!renewed || renewed.generation !== lease.generation) throw new Error('Collector ownership changed');
        });
        const writes: EventWrite[] = [];
        const seen = new Set<string>();
        let conflicts = 0;
        let prepared = 0;
        for (const [position, event] of fused.entries()) {
          if (prepared++ % 100 === 0) {
            const renewed = await acquireCollectorLease(pool, owner);
            if (!renewed || renewed.generation !== lease.generation) throw new Error('Collector ownership changed');
          }
          const identities = identityGroups[position];
          const rows = storedMatches[position];
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
        const recorded = await recordCollectorOutcome(pool, lease, { success: true, health: sourceHealth,
          error: conflicts ? `${conflicts} candidates skipped: identity reconciliation required` : null });
        if (!recorded) throw new Error('Collector ownership changed');
        failures = 0; console.log(`Committed ${writes.length} events`);
      } catch (error) {
        failures++;
        const message = error instanceof Error ? error.message : 'Collection failed';
        console.error(message);
        await recordCollectorOutcome(pool, lease, { success: false, error: message, health: sourceHealth }).catch(() => {});
      } finally { await releaseCollectorLease(pool, lease).catch(() => {}); }
    }
    const wait = Math.min(90000 * 2 ** Math.min(failures, 4), 900000) + Math.floor(Math.random() * 5000);
    await delay(wait, undefined, { signal: stop.signal }).catch(() => {});
  }
} finally { await pool.end(); }

}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Collector failed"); process.exitCode = 1; });
