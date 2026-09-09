'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';

interface BreakingNewsItem {
  id: string;
  title: string;
  description?: string;
  link?: string;
  published: string;
  source: string;
  sources?: string[];
  source_count?: number;
  risk_score?: number;
  confidence?: 'low' | 'medium' | 'high';
  coords: [number, number] | null; // [lat, lng]
  location?: string;
  location_confidence?: number;
  age_minutes?: number;
}

interface NewsPayload {
  news?: BreakingNewsItem[];
  healthy_sources?: number;
  source_count?: number;
  timestamp?: string;
}

const STORAGE_KEY = 'osiris.breaking-news-visible';
const REFRESH_MS = 120_000;
const MAX_MARKERS = 36;

function relativeTime(published: string) {
  const age = Math.max(0, Date.now() - new Date(published).getTime());
  const mins = Math.round(age / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function freshness(ageMinutes: number) {
  if (ageMinutes <= 30) return { color: '#2BD9FF', glow: 22, opacity: 1, pulse: true, label: '<30m' };
  if (ageMinutes <= 120) return { color: '#168BFF', glow: 16, opacity: 0.9, pulse: false, label: '<2h' };
  if (ageMinutes <= 360) return { color: '#386EAE', glow: 10, opacity: 0.72, pulse: false, label: '<6h' };
  return { color: '#34506F', glow: 6, opacity: 0.5, pulse: false, label: '6h+' };
}

function appendLine(root: HTMLElement, label: string, value: string, accent = false) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:5px;font:10px ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.35;';
  const key = document.createElement('span');
  key.textContent = label;
  key.style.cssText = 'color:#60758c;min-width:64px;text-transform:uppercase;letter-spacing:.08em;';
  const val = document.createElement('span');
  val.textContent = value;
  val.style.color = accent ? '#2BD9FF' : '#d7e3f0';
  row.append(key, val);
  root.append(row);
}

function popupNode(item: BreakingNewsItem) {
  const root = document.createElement('div');
  root.style.cssText = 'width:min(360px,72vw);background:#07111d;color:#e7f3ff;padding:12px;border:1px solid rgba(43,217,255,.55);box-shadow:0 0 28px rgba(0,140,255,.22);';

  const header = document.createElement('div');
  header.textContent = 'BREAKING NEWS';
  header.style.cssText = 'color:#2BD9FF;font:700 11px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.16em;margin-bottom:8px;';
  root.append(header);

  const title = document.createElement('div');
  title.textContent = item.title;
  title.style.cssText = 'font:600 13px system-ui,sans-serif;line-height:1.35;margin-bottom:8px;color:#f4f8fb;';
  root.append(title);

  const published = new Date(item.published);
  appendLine(root, 'SOURCE', (item.sources?.length ? item.sources : [item.source]).join(' · '));
  appendLine(root, 'DATE', published.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }));
  appendLine(root, 'LOCAL', published.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  appendLine(root, 'ZULU', `${published.toISOString().slice(11, 19)}Z`);
  appendLine(root, 'AGE', relativeTime(item.published), true);
  if (item.location) appendLine(root, 'LOCATION', item.location);
  appendLine(root, 'RISK', String(item.risk_score ?? '—'));
  appendLine(root, 'CONF', String(item.confidence ?? 'low').toUpperCase());

  if (item.link) {
    const link = document.createElement('a');
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'OPEN SOURCE ↗';
    link.style.cssText = 'display:inline-block;margin-top:10px;color:#2BD9FF;font:700 10px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.08em;text-decoration:none;';
    root.append(link);
  }
  return root;
}

function BreakingNewsMarkers({ mapRef }: { mapRef: React.RefObject<MlMap | null> }) {
  const [enabled, setEnabled] = useState(true);
  const [payload, setPayload] = useState<NewsPayload>({});
  const [loading, setLoading] = useState(false);
  const markers = useRef<Marker[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setEnabled(stored !== '0');
    } catch { /* storage can be unavailable */ }
  }, []);

  const toggle = () => {
    setEnabled(value => {
      const next = !value;
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    setLoading(true);
    try {
      const response = await fetch('/api/news', { cache: 'no-store' });
      if (!response.ok) return;
      setPayload(await response.json());
    } catch (error) {
      console.warn('[OSIRIS] Breaking news layer refresh failed:', error instanceof Error ? error.message : error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  useEffect(() => {
    const map = mapRef.current;
    markers.current.forEach(marker => marker.remove());
    markers.current = [];
    if (!map || !enabled) return;

    const news = (payload.news || [])
      .filter(item => Array.isArray(item.coords) && Number(item.location_confidence ?? 0) >= 0.85)
      .slice(0, MAX_MARKERS);

    for (const item of news) {
      const [lat, lng] = item.coords!;
      const ageMinutes = item.age_minutes ?? Math.max(0, Math.round((Date.now() - new Date(item.published).getTime()) / 60_000));
      const fresh = freshness(ageMinutes);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = fresh.pulse ? 'osiris-breaking-marker osiris-breaking-marker--pulse' : 'osiris-breaking-marker';
      el.title = `${relativeTime(item.published)} · ${item.title}`;
      el.setAttribute('aria-label', `Breaking news: ${item.title}`);
      el.style.cssText = [
        'width:18px;height:18px;border-radius:50%;cursor:pointer;',
        `background:${fresh.color};border:2px solid rgba(225,247,255,.95);`,
        `box-shadow:0 0 ${fresh.glow}px ${fresh.color},0 0 ${Math.round(fresh.glow / 2)}px ${fresh.color};`,
        `opacity:${fresh.opacity};display:grid;place-items:center;padding:0;`,
      ].join('');
      const core = document.createElement('span');
      core.style.cssText = 'width:5px;height:5px;border-radius:50%;background:#06111e;box-shadow:0 0 0 1px rgba(255,255,255,.35);';
      el.append(core);

      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 14, maxWidth: '380px' })
        .setDOMContent(popupNode(item));
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map);
      markers.current.push(marker);
    }

    return () => {
      markers.current.forEach(marker => marker.remove());
      markers.current = [];
    };
  }, [mapRef, enabled, payload.news]);

  const mappable = (payload.news || []).filter(item => item.coords && Number(item.location_confidence ?? 0) >= 0.85).length;

  return (
    <>
      <style jsx global>{`
        @keyframes osiris-breaking-pulse {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.28); filter: brightness(1.35); }
        }
        .osiris-breaking-marker--pulse { animation: osiris-breaking-pulse 1.35s ease-in-out infinite; }
        .maplibregl-popup-content { padding: 0 !important; background: transparent !important; box-shadow: none !important; }
        .maplibregl-popup-close-button { color: #9fdfff !important; z-index: 3; font-size: 18px; right: 5px !important; top: 3px !important; }
      `}</style>
      <div
        className="pointer-events-auto absolute bottom-12 left-16 z-[46] flex items-center gap-2 rounded-md px-2.5 py-2 font-mono text-[9px] tracking-[0.12em]"
        style={{
          background: 'rgba(4,12,22,.92)',
          border: `1px solid ${enabled ? 'rgba(43,217,255,.62)' : 'rgba(120,140,160,.26)'}`,
          boxShadow: enabled ? '0 0 18px rgba(0,140,255,.16)' : 'none',
          color: enabled ? '#9EEBFF' : '#718096',
        }}
      >
        <button type="button" onClick={toggle} className="flex items-center gap-2" aria-pressed={enabled}>
          <span
            className={enabled ? 'animate-pulse' : ''}
            style={{ width: 7, height: 7, borderRadius: 999, background: enabled ? '#2BD9FF' : '#536274', boxShadow: enabled ? '0 0 10px #168BFF' : 'none' }}
          />
          BREAKING NEWS {enabled ? 'ON' : 'OFF'}
        </button>
        <span style={{ color: '#53677a' }}>·</span>
        <span>{mappable} MAP</span>
        <span style={{ color: '#53677a' }}>·</span>
        <span>{payload.healthy_sources ?? 0}/{payload.source_count ?? 0} SRC</span>
        {loading && <span style={{ color: '#2BD9FF' }}>SYNC</span>}
      </div>
    </>
  );
}

export default memo(BreakingNewsMarkers);
