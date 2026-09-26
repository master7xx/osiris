export type CollectorStage = 'lease' | 'sources' | 'signals_write' | 'signals_read' | 'fusion' | 'identities' | 'prepare' | 'commit' | 'outcome' | 'release';
export type CollectorCycleResult = 'success' | 'failed' | 'skipped' | 'cancelled';
export interface CollectorCycleCounts { input_signals: number; retained_signals: number; candidates: number; processed_events: number; committed_batches: number; skipped_conflicts: number }

/** Console-only diagnostics. Durations use a monotonic clock; timestamps use UTC wall time. */
export function collectorCycleLog(cycleId: string, emit = (line: string) => console.log(line), wall = Date.now, monotonic = () => performance.now()) {
  const startedAt = new Date(wall()).toISOString();
  const started = monotonic();
  let stage: CollectorStage | undefined;
  let stageStarted = started;
  let finished = false;
  const stages: Partial<Record<CollectorStage, number>> = {};
  const elapsed = (from: number) => Math.max(0, Math.round(monotonic() - from));
  const write = (data: object) => emit(`[collector] ${JSON.stringify({ timestamp: new Date(wall()).toISOString(), cycle_id: cycleId, ...data })}`);
  const closeStage = () => { if (stage) stages[stage] = (stages[stage] ?? 0) + elapsed(stageStarted); };
  write({ event: 'cycle_start', started_at: startedAt });
  return {
    stage(next: CollectorStage) {
      if (finished) return;
      closeStage(); stage = next; stageStarted = monotonic();
      write({ event: 'stage_start', stage, elapsed_ms: elapsed(started), stages_ms: { ...stages } });
    },
    currentStage: () => stage,
    finish(result: CollectorCycleResult, counts: CollectorCycleCounts, failedStage?: CollectorStage) {
      if (finished) return;
      closeStage(); finished = true;
      write({ event: 'cycle_end', result, started_at: startedAt, duration_ms: elapsed(started),
        stages_ms: { ...stages }, ...(failedStage ? { failed_stage: failedStage } : {}),
        // Explicit numeric allowlist: never serialize source payloads/errors or DB connection details.
        input_signals: counts.input_signals, retained_signals: counts.retained_signals,
        candidates: counts.candidates, processed_events: counts.processed_events,
        committed_batches: counts.committed_batches, skipped_conflicts: counts.skipped_conflicts });
    },
    schedule(waitMs: number) {
      write({ event: 'cycle_wait', wait_ms: waitMs, next_attempt_at: new Date(wall() + waitMs).toISOString() });
    },
  };
}
