'use client';
import { useEffect, useRef } from 'react';
import { useWorldEvents } from './WorldEventsProvider';
import { isMappable, safeEventUrl, WORLD_EVENT_CATEGORIES } from '@/lib/world-events-view';
import { SeverityBadge, SourceBadge } from './WorldEventBadges';
import './world-events.css';

export default function WorldEventsPanel({ onLocate }: { onLocate?: () => void }) {
  const feed = useWorldEvents();
  const selected = useRef<HTMLElement | null>(null);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [feed.selectedId, feed.mapSelection]);
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => { list.current?.scrollTo({ top: 0 }); }, [feed.filters.category, feed.filters.severity, feed.filters.confidence, feed.filters.mappable]);
  const categories = WORLD_EVENT_CATEGORIES;
  return <section className="world-events" aria-label="World events">
    <div className="world-events-filters">
      <strong>WORLD EVENTS · {feed.events.length}</strong>
      <label>Category<select value={feed.filters.category} onChange={e => feed.setFilters({ ...feed.filters, category: e.target.value })}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
      <label>Severity<select value={feed.filters.severity} onChange={e => feed.setFilters({ ...feed.filters, severity: Number(e.target.value) })}><option value={0}>All severities</option><option value={35}>35+</option><option value={70}>70+ · High</option></select></label>
      <label>Confidence<select value={feed.filters.confidence} onChange={e => feed.setFilters({ ...feed.filters, confidence: e.target.value })}><option value="">All confidence levels</option>{['unconfirmed', 'corroborating', 'confirmed'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={feed.filters.mappable} onChange={e => feed.setFilters({ ...feed.filters, mappable: e.target.checked })} /> Located events only</label>
      <label><input type="checkbox" checked={feed.enabled} onChange={e => feed.setEnabled(e.target.checked)} /> Show markers ({feed.mappable.length})</label>
    </div>
    <div className="world-events-status" role="status">
      {feed.fromCache ? 'CACHED DATA · ' : ''}{feed.loading ? 'Refreshing… ' : ''}{feed.stale ? 'STALE · ' : ''}{feed.partial ? 'PARTIAL SOURCES · ' : ''}
      {feed.error && `${feed.snapshot ? 'Refresh failed; keeping previous snapshot' : 'Unable to load events'}: ${feed.error} `}
      {feed.snapshot && <span>{feed.snapshot.healthy_sources}/{feed.snapshot.source_count} sources · Snapshot {new Date(feed.snapshot.generated_at).toLocaleTimeString([], { timeZone: 'UTC', hour12: false })} UTC</span>}
      <button type="button" disabled={feed.loading} onClick={() => void feed.refresh()}>Refresh</button>
    </div>
    <div ref={list} className="world-events-list">
      {feed.selectedId && !feed.events.some(event => event.id === feed.selectedId) && <p role="status">Selected event is outside the current filters or snapshot.</p>}
      {!feed.loading && !feed.error && !feed.events.length && <p>No events match these filters.</p>}
      {feed.events.map(event => <article key={event.id} ref={event.id === feed.selectedId ? selected : undefined} className="world-event-card" data-selected={event.id === feed.selectedId}>
        <div className="world-event-meta"><SeverityBadge severity={event.severity} /><span>{event.category}</span><span>{event.confidence}</span></div>
        <button type="button" className="world-event-title" aria-pressed={event.id === feed.selectedId} onClick={() => { feed.selectEvent(event.id, 'list'); if (isMappable(event)) onLocate?.(); }}>{event.title}</button>
        <div className="world-event-location">{event.location || 'Location unspecified'}{!isMappable(event) && ' · No reliable map position'}</div>
        <time className="world-event-time" dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString([], { timeZone: 'UTC', hour12: false })} UTC</time>
        <div className="world-event-sources">{event.sources.map(source => <SourceBadge key={source} source={source} evidence={event.evidence.find(item => item.source === source)} />)}<span className="world-event-source-count">{event.independent_sources} independent</span></div>
        {event.id === feed.selectedId && <div className="world-event-detail"><p>{event.description}</p><strong>Evidence</strong>{event.evidence.map((evidence, index) => <div key={`${evidence.source_id}-${index}`}><SourceBadge source={evidence.source} evidence={evidence} /> · {evidence.kind}{evidence.url && safeEventUrl(evidence.url) && <> · <a href={safeEventUrl(evidence.url)} target="_blank" rel="noopener noreferrer">Open source</a></>}</div>)}</div>}
      </article>)}
    </div>
  </section>;
}
