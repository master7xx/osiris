import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSourceHealthSnapshot,
  noteSourceFailure,
  noteSourceFreshness,
  noteSourceSuccess,
  resetSourceHealthForTests,
  shouldProbeSource,
  sourceHealthMultiplier,
} from './news-source-health';

describe('adaptive news source health', () => {
  beforeEach(() => resetSourceHealthForTests());

  it('starts healthy at full weight', () => {
    const health = getSourceHealthSnapshot('source-a', 1.1, 1_000);
    expect(health.state).toBe('healthy');
    expect(health.effective_weight).toBe(1.1);
    expect(health.success_rate).toBe(1);
  });

  it('keeps latency diagnostic-only even on a very slow successful connection', () => {
    noteSourceSuccess('source-a', 25_000, 6, 1_000);
    noteSourceSuccess('source-a', 18_000, 4, 2_000);
    noteSourceFreshness('source-a', 4, 1_900, 2_000);
    const health = getSourceHealthSnapshot('source-a', 1, 2_001);
    expect(health.avg_latency_ms).toBeGreaterThan(10_000);
    expect(health.state).toBe('healthy');
    expect(health.effective_weight).toBe(1);
  });

  it('penalizes failures and enters cooldown after repeated failures', () => {
    noteSourceFailure('source-a', 'timeout', 6500, 1_000);
    expect(sourceHealthMultiplier('source-a', 1_001)).toBeLessThan(1);
    expect(shouldProbeSource('source-a', 1_001)).toBe(true);

    noteSourceFailure('source-a', 'timeout', 6500, 2_000);
    const health = getSourceHealthSnapshot('source-a', 1, 2_001);
    expect(health.state).toBe('cooldown');
    expect(health.consecutive_failures).toBe(2);
    expect(health.cooldown_until).toBeTruthy();
    expect(shouldProbeSource('source-a', 2_001)).toBe(false);
  });

  it('penalizes repeated empty successful responses without treating them as hard failures', () => {
    noteSourceSuccess('source-a', 200, 0, 1_000);
    noteSourceSuccess('source-a', 220, 0, 2_000);
    const health = getSourceHealthSnapshot('source-a', 1, 2_001);
    expect(health.state).toBe('degraded');
    expect(health.empty_streak).toBe(2);
    expect(health.success_rate).toBe(1);
    expect(health.effective_weight).toBeLessThan(1);
  });

  it('degrades only after several successful cycles without fresh 24h content', () => {
    for (let cycle = 1; cycle <= 2; cycle += 1) {
      noteSourceSuccess('source-a', 15_000, 8, cycle * 1_000);
      noteSourceFreshness('source-a', 0, undefined, cycle * 1_000);
    }
    let health = getSourceHealthSnapshot('source-a', 1, 2_001);
    expect(health.state).toBe('healthy');
    expect(health.stale_streak).toBe(2);
    expect(health.effective_weight).toBe(1);

    noteSourceSuccess('source-a', 30_000, 8, 3_000);
    noteSourceFreshness('source-a', 0, undefined, 3_000);
    health = getSourceHealthSnapshot('source-a', 1, 3_001);
    expect(health.state).toBe('degraded');
    expect(health.stale_streak).toBe(3);
    expect(health.effective_weight).toBeLessThan(1);
    expect(shouldProbeSource('source-a', 3_001)).toBe(true);
  });

  it('recovers freshness immediately when current content returns', () => {
    noteSourceSuccess('source-a', 200, 5, 1_000);
    noteSourceFreshness('source-a', 0, undefined, 1_000);
    noteSourceFreshness('source-a', 0, undefined, 2_000);
    noteSourceFreshness('source-a', 0, undefined, 3_000);
    expect(getSourceHealthSnapshot('source-a', 1, 3_001).state).toBe('degraded');

    const newest = 3_500;
    noteSourceFreshness('source-a', 2, newest, 4_000);
    const health = getSourceHealthSnapshot('source-a', 1, 4_001);
    expect(health.stale_streak).toBe(0);
    expect(health.fresh_items).toBe(2);
    expect(health.newest_item_at).toBe(new Date(newest).toISOString());
    expect(health.newest_age_minutes).toBe(0);
    expect(health.state).toBe('healthy');
  });

  it('recovers after a successful probe', () => {
    noteSourceFailure('source-a', 'timeout', 6000, 1_000);
    noteSourceFailure('source-a', 'timeout', 6000, 2_000);
    expect(shouldProbeSource('source-a', 62_001)).toBe(true);

    noteSourceSuccess('source-a', 180, 6, 62_001);
    noteSourceFreshness('source-a', 6, 62_000, 62_001);
    const health = getSourceHealthSnapshot('source-a', 1, 62_002);
    expect(health.consecutive_failures).toBe(0);
    expect(health.empty_streak).toBe(0);
    expect(health.stale_streak).toBe(0);
    expect(health.state).not.toBe('cooldown');
    expect(shouldProbeSource('source-a', 62_002)).toBe(true);
  });
});
