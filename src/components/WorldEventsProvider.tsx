'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UnifiedEventFeed } from '@/lib/event-feed';
import { DEFAULT_EVENT_FILTERS, filterWorldEvents, isMappable, type EventFilters } from '@/lib/world-events-view';
import { setEventIngestHealth } from '@/lib/event-health-client';

function useWorldEventsState(onMapSelect: () => void) {
  const [snapshot, setSnapshot] = useState<UnifiedEventFeed | null>(null);
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_EVENT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapSelection, setMapSelection] = useState(0);
  const [locateRequest, setLocateRequest] = useState<{ id: string; version: number } | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  const onMapSelectRef = useRef(onMapSelect);
  useEffect(() => { onMapSelectRef.current = onMapSelect; }, [onMapSelect]);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setLoading(true);
    try {
      const response = await fetch('/api/events?limit=300', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next: UnifiedEventFeed = await response.json();
      if (!Array.isArray(next.events) || !Array.isArray(next.source_health) || !Number.isFinite(Date.parse(next.generated_at))) throw new Error('Invalid event snapshot');
      if (request.current !== controller) return;
      setSnapshot(next); setEventIngestHealth(next); setError('');
    } catch (err) {
      if (request.current === controller) setError(err instanceof Error ? err.message : 'Event refresh failed');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); setNow(Date.now()); }
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 90000);
    const clock = setInterval(() => setNow(Date.now()), 15000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { const current = request.current; request.current = null; current?.abort(); clearTimeout(initial); clearInterval(poll); clearInterval(clock); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const events = useMemo(() => filterWorldEvents(snapshot?.events ?? [], filters), [snapshot, filters]);
  const mappable = useMemo(() => events.filter(isMappable), [events]);
  const selectEvent = useCallback((id: string, origin: 'map' | 'list') => {
    setSelectedId(id);
    if (origin === 'map') { setMapSelection(value => value + 1); onMapSelectRef.current(); }
    else setLocateRequest(previous => ({ id, version: (previous?.version ?? 0) + 1 }));
  }, []);
  return { snapshot, events, mappable, filters, setFilters, selectedId, selectEvent, mapSelection, locateRequest,
    enabled, setEnabled, loading, error, refresh,
    stale: !!snapshot && now - Date.parse(snapshot.generated_at) > 180000,
    partial: !!snapshot && (snapshot.healthy_sources < snapshot.source_count || snapshot.source_health.some(source => source.state !== 'healthy')) };
}
const WorldEventsContext = createContext<ReturnType<typeof useWorldEventsState> | null>(null);
export function WorldEventsProvider({ children, onMapSelect }: { children: ReactNode; onMapSelect: () => void }) {
  const value = useWorldEventsState(onMapSelect);
  return <WorldEventsContext.Provider value={value}>{children}</WorldEventsContext.Provider>;
}
export function useWorldEvents() {
  const value = useContext(WorldEventsContext);
  if (!value) throw new Error('WorldEventsProvider is required');
  return value;
}
