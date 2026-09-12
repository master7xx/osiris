import { isNewsDigest } from './event-text';
import { eventTitleSimilarity, type FusedEvent } from './event-fusion';

export type EventLifecycle = 'new' | 'updated' | 'ongoing';

export interface ContinuousEvent extends Omit<FusedEvent, 'id'> {
  id: string;
  fused_id: string;
  lifecycle: EventLifecycle;
  first_observed_at: string;
  last_observed_at: string;
  changed_at: string;
  update_count: number;
  change_sequence: number;
}

interface LedgerEntry {
  stableId: string;
  event: ContinuousEvent;
}

interface EventLedgerState {
  entries: Map<string, LedgerEntry>;
  nextSequence: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __OSIRIS_EVENT_LEDGER__: EventLedgerState | undefined;
}

const RETENTION_MS = 48 * 60 * 60_000;

function state(): EventLedgerState {
  if (!globalThis.__OSIRIS_EVENT_LEDGER__) {
    globalThis.__OSIRIS_EVENT_LEDGER__ = { entries: new Map(), nextSequence: 0 };
  }
  return globalThis.__OSIRIS_EVENT_LEDGER__;
}

function toMs(value?: string) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function distanceKm(a: FusedEvent, b: ContinuousEvent) {
  if (![a.lat, a.lng, b.lat, b.lng].every(value => typeof value === 'number' && Number.isFinite(value))) return undefined;
  const lat1 = a.lat! * Math.PI / 180;
  const lat2 = b.lat! * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (b.lng! - a.lng!) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function urlOverlap(a: FusedEvent, b: ContinuousEvent) {
  if (!a.urls.length || !b.urls.length) return false;
  const urls = new Set(a.urls);
  return b.urls.some(url => urls.has(url));
}

function matches(a: FusedEvent, b: ContinuousEvent) {
  if (a.id === b.fused_id) return true;
  if (isNewsDigest(a.title, a.description) !== isNewsDigest(b.title, b.description)) return false;
  if (urlOverlap(a, b)) return true;

  const timeDelta = Math.abs(toMs(a.occurred_at) - toMs(b.occurred_at));
  if (timeDelta > 12 * 60 * 60_000) return false;
  if (a.category !== b.category && !a.categories.some(category => b.categories.includes(category))) return false;

  const similarity = eventTitleSimilarity(a.title, b.title);
  const distance = distanceKm(a, b);

  // Earthquake feeds often contain several genuine shocks in the same area.
  // Stable upstream IDs/URLs have already matched above. Without that direct
  // identity evidence, reconcile only a near-simultaneous, near-identical
  // report rather than collapsing separate aftershocks into one event.
  if (a.category === 'earthquake') {
    return similarity >= 0.8
      && distance !== undefined
      && distance <= 10
      && timeDelta <= 10 * 60_000;
  }
  if (similarity >= 0.72 && (distance === undefined || distance <= 300)) return true;
  return similarity >= 0.4 && distance !== undefined && distance <= 80 && timeDelta <= 3 * 60 * 60_000;
}

function materialChange(previous: ContinuousEvent, next: FusedEvent) {
  // Compare report content, excluding identity, observation clocks and derived
  // freshness/priority. Reordering evidence must not create a new revision.
  const content = (event: FusedEvent) => JSON.stringify({
    title: event.title,
    description: event.description,
    category: event.category,
    categories: [...event.categories].sort(),
    occurred_at: toMs(event.occurred_at),
    lat: event.lat,
    lng: event.lng,
    location: event.location,
    location_confidence: event.location_confidence,
    confidence: event.confidence,
    severity: event.severity,
    status: event.status,
    source_count: event.source_count,
    independent_sources: event.independent_sources,
    evidence_weight: event.evidence_weight,
    sources: [...event.sources].sort(),
    urls: [...event.urls].sort(),
    tags: [...event.tags].sort(),
    evidence: event.evidence.map(item => JSON.stringify([
      item.source_id, item.source, item.kind, item.independent, item.weight,
      item.url, toMs(item.published_at),
    ])).sort(),
  });
  return content(previous) !== content(next);
}

function prune(now: number) {
  const ledger = state();
  for (const [id, entry] of ledger.entries) {
    if (now - toMs(entry.event.last_observed_at) > RETENTION_MS) ledger.entries.delete(id);
  }
}

export function applyEventLedger(events: FusedEvent[], now = Date.now()) {
  prune(now);
  const ledger = state();
  const observedAt = new Date(now).toISOString();
  const output: ContinuousEvent[] = [];

  for (const incoming of events) {
    const existing = [...ledger.entries.values()].find(entry => matches(incoming, entry.event));

    if (!existing) {
      const sequence = ++ledger.nextSequence;
      const event: ContinuousEvent = {
        ...incoming,
        id: incoming.id,
        fused_id: incoming.id,
        lifecycle: 'new',
        first_observed_at: observedAt,
        last_observed_at: observedAt,
        changed_at: observedAt,
        update_count: 0,
        change_sequence: sequence,
      };
      ledger.entries.set(event.id, { stableId: event.id, event });
      output.push(event);
      continue;
    }

    const changed = materialChange(existing.event, incoming);
    const sequence = changed ? ++ledger.nextSequence : existing.event.change_sequence;
    const event: ContinuousEvent = {
      ...incoming,
      id: existing.stableId,
      fused_id: incoming.id,
      lifecycle: changed ? 'updated' : 'ongoing',
      first_observed_at: existing.event.first_observed_at,
      last_observed_at: observedAt,
      changed_at: changed ? observedAt : existing.event.changed_at,
      update_count: existing.event.update_count + (changed ? 1 : 0),
      change_sequence: sequence,
    };
    existing.event = event;
    output.push(event);
  }

  return {
    events: output,
    cursor: ledger.nextSequence,
  };
}

export function resetEventLedgerForTests() {
  globalThis.__OSIRIS_EVENT_LEDGER__ = undefined;
}
