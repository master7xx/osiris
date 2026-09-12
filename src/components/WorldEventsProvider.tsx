'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UnifiedEventFeed } from '@/lib/event-feed';
import { DEFAULT_EVENT_FILTERS, projectWorldEvents, isMappable, type EventFilters } from '@/lib/world-events-view';
import { readEventCache, writeEventCache } from '@/lib/client-event-cache';
import { synchronizeEvents, type EventClientCache } from '@/lib/client-event-sync';
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
  const [retainedIds, setRetainedIds] = useState<string[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const checkpoint = useRef<EventClientCache | null>(null);
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
      const next = await synchronizeEvents(checkpoint.current, fetch, controller.signal);
      if (request.current !== controller) return;
      checkpoint.current = next;
      writeEventCache(next);
      setRetainedIds(next.retainedIds ?? []); setSnapshot(next.feed); setEventIngestHealth(next.feed); setError(''); setFromCache(false);
    } catch (err) {
      if (request.current === controller) { setError(err instanceof Error ? err.message : 'Event refresh failed'); setFromCache(Boolean(checkpoint.current)); }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); setNow(Date.now()); }
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => {
      const cached = readEventCache();
      if (cached) { checkpoint.current = cached; setRetainedIds(cached.retainedIds ?? []); setSnapshot(cached.feed); setEventIngestHealth(cached.feed); setFromCache(true); setNow(Date.now()); }
      void refresh();
    }, 0);
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 90000);
    const clock = setInterval(() => setNow(Date.now()), 15000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => { const current = request.current; request.current = null; current?.abort(); clearTimeout(initial); clearInterval(poll); clearInterval(clock); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); };
  }, [refresh]);
  const view = useMemo(() => projectWorldEvents(snapshot?.events ?? [], filters, now), [snapshot, filters, now]);
  const events = view.events;
  const mappable = useMemo(() => events.filter(isMappable), [events]);
  const selectEvent = useCallback((id: string, origin: 'map' | 'list') => {
    setSelectedId(id);
    if (origin === 'map') { setMapSelection(value => value + 1); onMapSelectRef.current(); }
    else setLocateRequest(previous => ({ id, version: (previous?.version ?? 0) + 1 }));
  }, []);
  return { snapshot, events, mappable, retainedIds, matching: view.matching, sources: view.sources, filters, setFilters, selectedId, selectEvent, mapSelection, locateRequest,
    enabled, setEnabled, loading, error, refresh, fromCache,
    stale: !!snapshot && (fromCache || now - Date.parse(snapshot.generated_at) > 180000),
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
