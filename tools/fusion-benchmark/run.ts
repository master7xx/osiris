import { performance } from 'node:perf_hooks';
import { deepStrictEqual } from 'node:assert';
import { fuseEvents } from '../../src/lib/event-fusion';
import { fuseEvents as reference } from './reference';
import { fusionFixture, providerFixture } from './fixtures';
const sizes = process.argv.slice(2).map(Number);
for (const [workload, fixture] of [['mixed', fusionFixture], ['provider', providerFixture]] as const) {
  for (const size of sizes.length ? sizes : [1000, 3000, 5600]) {
    if (!Number.isInteger(size) || size < 1 || size > 20000) throw new Error('Size must be 1..20000');
    const events = fixture(size);
    const options = { now: Date.parse('2026-09-26T22:00:00Z'), limit: events.length };
    const before = performance.now();
    const expected = reference(events, options);
    const referenceMs = performance.now() - before;
    const start = performance.now();
    const actual = fuseEvents(events, options);
    const optimizedMs = performance.now() - start;
    deepStrictEqual(actual, expected);
    console.log(JSON.stringify({ workload, signals: size, clusters: actual.length, reference_ms: Math.round(referenceMs), optimized_ms: Math.round(optimizedMs), speedup: Number((referenceMs / optimizedMs).toFixed(2)), identical: true }));
  }
}
