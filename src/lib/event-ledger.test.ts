import { beforeEach, describe, expect, it } from 'vitest';
import { applyEventLedger, resetEventLedgerForTests } from './event-ledger';
import type { FusedEvent } from './event-fusion';

function event(overrides: Partial<FusedEvent> = {}): FusedEvent {
  return {
    id: 'evt-a',
    title: 'Explosion reported in central city',
    description: '',
    category: 'conflict',
    categories: ['conflict'],
    occurred_at: '2026-09-12T08:00:00.000Z',
    first_seen_at: '2026-09-12T08:01:00.000Z',
    last_seen_at: '2026-09-12T08:01:00.000Z',
    lat: 53.9,
    lng: 27.56,
    location: 'Minsk, Belarus',
    location_confidence: 0.95,
    severity: 70,
    priority_score: 75,
    confidence: 'unconfirmed',
    status: 'active',
    evidence: [{ source_id: 'news:a', source: 'A', kind: 'editorial', independent: true, weight: 1, url: 'https://a.test/1' }],
    sources: ['A'],
    source_count: 1,
    independent_sources: 1,
    evidence_weight: 1,
    urls: ['https://a.test/1'],
    tags: ['news'],
    age_minutes: 5,
    ...overrides,
  };
}

describe('event continuity ledger', () => {
  beforeEach(() => resetEventLedgerForTests());

  it('marks first observation as new and preserves a stable id on later refreshes', () => {
    const first = applyEventLedger([event()], Date.parse('2026-09-12T08:05:00Z'));
    const second = applyEventLedger([event({ id: 'evt-rebuilt' })], Date.parse('2026-09-12T08:06:00Z'));

    expect(first.events[0].lifecycle).toBe('new');
    expect(second.events[0].id).toBe(first.events[0].id);
    expect(second.events[0].fused_id).toBe('evt-rebuilt');
    expect(second.events[0].lifecycle).toBe('ongoing');
    expect(second.cursor).toBe(first.cursor);
  });

  it('turns corroboration into an update instead of a new event', () => {
    const first = applyEventLedger([event()], Date.parse('2026-09-12T08:05:00Z'));
    const corroborated = event({
      id: 'evt-b',
      confidence: 'confirmed',
      source_count: 2,
      independent_sources: 2,
      evidence_weight: 2.1,
      priority_score: 91,
      sources: ['A', 'B'],
      urls: ['https://a.test/1', 'https://b.test/2'],
      evidence: [
        ...event().evidence,
        { source_id: 'news:b', source: 'B', kind: 'editorial', independent: true, weight: 1.1, url: 'https://b.test/2' },
      ],
    });
    const second = applyEventLedger([corroborated], Date.parse('2026-09-12T08:07:00Z'));

    expect(second.events[0].id).toBe(first.events[0].id);
    expect(second.events[0].lifecycle).toBe('updated');
    expect(second.events[0].update_count).toBe(1);
    expect(second.cursor).toBeGreaterThan(first.cursor);
  });

  it('does not merge separate earthquake events merely because they are nearby', () => {
    const a = event({ id: 'eq-a', category: 'earthquake', categories: ['earthquake'], title: 'M5.1 earthquake — region A', lat: 35.1, lng: 140.1 });
    const b = event({ id: 'eq-b', category: 'earthquake', categories: ['earthquake'], title: 'M4.7 earthquake — region B', lat: 35.2, lng: 140.2, occurred_at: '2026-09-12T08:40:00Z', urls: ['https://b.test/eq'] });

    const first = applyEventLedger([a], Date.parse('2026-09-12T08:45:00Z'));
    const second = applyEventLedger([b], Date.parse('2026-09-12T08:46:00Z'));

    expect(second.events[0].id).not.toBe(first.events[0].id);
    expect(second.events[0].lifecycle).toBe('new');
  });
});
