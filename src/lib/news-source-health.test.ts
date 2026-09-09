import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSourceHealthSnapshot,
  noteSourceFailure,
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

  it('recovers after a successful probe', () => {
    noteSourceFailure('source-a', 'timeout', 6000, 1_000);
    noteSourceFailure('source-a', 'timeout', 6000, 2_000);
    expect(shouldProbeSource('source-a', 62_001)).toBe(true);

    noteSourceSuccess('source-a', 180, 6, 62_001);
    const health = getSourceHealthSnapshot('source-a', 1, 62_002);
    expect(health.consecutive_failures).toBe(0);
    expect(health.empty_streak).toBe(0);
    expect(health.state).not.toBe('cooldown');
    expect(shouldProbeSource('source-a', 62_002)).toBe(true);
  });
});
