'use client';
import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';
import { useWorldEvents } from './WorldEventsProvider';
import { isMappable } from '@/lib/world-events-view';

export default function BreakingNewsMarkers({ mapRef }: { mapRef: React.RefObject<MlMap | null> }) {
  const feed = useWorldEvents();
  const markers = useRef(new Map<string, Marker>());
  const { mappable, enabled, selectEvent, selectedId, locateRequest, snapshot } = feed;
  const lastLocate = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enabled) return;
    const current = markers.current;
    for (const event of mappable) {
      const button = document.createElement('button');
      button.type = 'button'; button.title = event.title; button.setAttribute('aria-label', event.title);
      button.style.cssText = 'width:26px;height:26px;border-radius:50%;border:2px solid #00d9ff;background:#053753;color:white;cursor:pointer;font-size:15px;';
      button.textContent = '≡';
      button.addEventListener('click', () => selectEvent(event.id, 'map'));
      const marker = new maplibregl.Marker({ element: button }).setLngLat([event.lng!, event.lat!]).addTo(map);
      current.set(event.id, marker);
    }
    return () => { current.forEach(marker => marker.remove()); current.clear(); };
  }, [mapRef, mappable, enabled, selectEvent]);
  useEffect(() => {
    markers.current.forEach((marker, id) => {
      marker.getElement().style.boxShadow = id === selectedId ? '0 0 0 5px #ffffff88,0 0 22px #00d9ff' : '0 0 10px #00aaff66';
      marker.getElement().setAttribute('aria-pressed', String(id === selectedId));
    });
  }, [selectedId, mappable, enabled, selectEvent]);
  useEffect(() => {
    if (!locateRequest || lastLocate.current === locateRequest.version || !mapRef.current) return;
    lastLocate.current = locateRequest.version;
    const event = snapshot?.events.find(item => item.id === locateRequest.id);
    if (event && isMappable(event)) mapRef.current.flyTo({ center: [event.lng!, event.lat!], zoom: Math.max(mapRef.current.getZoom(), 6), essential: false });
  }, [locateRequest, snapshot, mapRef]);
  return <button type="button" className="absolute bottom-12 left-16 z-[46] rounded border border-cyan-700 bg-slate-950/90 px-3 py-2 text-[10px] text-cyan-300" aria-pressed={enabled} onClick={() => feed.setEnabled(!enabled)}>
    WORLD EVENTS {enabled ? 'ON' : 'OFF'} · {mappable.length} MAP · {feed.events.length} FEED{feed.stale ? ' · STALE' : feed.partial ? ' · PARTIAL' : ''}
  </button>;
}
