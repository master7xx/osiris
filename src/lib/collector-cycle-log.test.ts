import { expect, it } from 'vitest';
import { collectorCycleLog } from './collector-cycle-log';
const counts = { input_signals: 3000, retained_signals: 4000, candidates: 3500, processed_events: 600, committed_batches: 2, skipped_conflicts: 1 };
function fixture() {
  let wall = Date.parse('2026-09-26T22:00:00Z');
  let mono = 100;
  const lines: Record<string, unknown>[] = [];
  const log = collectorCycleLog('cycle-test', line => lines.push(JSON.parse(line.replace('[collector] ', ''))), () => wall, () => mono);
  return { log, lines, tick: (ms: number) => { wall += ms; mono += ms; }, rewindWall: () => { wall -= 60000; } };
}
it('separates stage durations, total duration and scheduled idle time despite clock correction', () => {
  const f = fixture();
  f.log.stage('lease'); f.tick(5);
  f.log.stage('sources'); f.tick(10000);
  f.rewindWall();
  f.log.stage('commit'); f.tick(200);
  f.log.finish('success', counts);
  f.log.schedule(90000);
  expect(f.lines[0]).toMatchObject({ event: 'cycle_start', cycle_id: 'cycle-test', started_at: '2026-09-26T22:00:00.000Z' });
  expect(f.lines.at(-2)).toMatchObject({ event: 'cycle_end', result: 'success', duration_ms: 10205,
    stages_ms: { lease: 5, sources: 10000, commit: 200 }, processed_events: 600 });
  expect(f.lines.at(-1)).toMatchObject({ event: 'cycle_wait', wait_ms: 90000, next_attempt_at: '2026-09-26T22:00:40.205Z' });
});
it('retains the failed stage and committed progress through outcome recording and release', () => {
  const f = fixture();
  f.log.stage('commit'); f.tick(40);
  const failed = f.log.currentStage();
  f.log.stage('outcome'); f.tick(10);
  f.log.stage('release'); f.tick(5);
  f.log.finish('failed', { ...counts, secret: 'postgres://private', error: 'private payload' } as typeof counts, failed);
  f.log.finish('success', counts);
  expect(f.lines.filter(l => l.event === 'cycle_end')).toHaveLength(1);
  expect(f.lines.at(-1)).toMatchObject({ result: 'failed', failed_stage: 'commit', duration_ms: 55, committed_batches: 2,
    stages_ms: { commit: 40, outcome: 10, release: 5 } });
  expect(JSON.stringify(f.lines)).not.toContain('private');
});
it.each(['skipped', 'cancelled'] as const)('reports %s without claiming a successful write', result => {
  const f = fixture(); f.log.stage('lease');
  f.log.finish(result, { input_signals: 0, retained_signals: 0, candidates: 0, processed_events: 0, committed_batches: 0, skipped_conflicts: 0 });
  expect(f.lines.at(-1)).toMatchObject({ result, processed_events: 0, committed_batches: 0 });
});
