'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { layoutTile, tileHeight, tilesOverlap, type TileGeometry } from '@/lib/map-tile-layout';
import type { Map as MlMap } from 'maplibre-gl';
import BreakingNewsMarkers from './BreakingNewsMarkers';

const MIN_ZOOM = 13;
const MAX_TILES = 4;
const GEOM: TileGeometry = { width: 208, imageHeight: 117, labelHeight: 20, gap: 26 };
const TILE_H = tileHeight(GEOM);
const NEWS = '#EC407A';
const news = (pct: number) => `color-mix(in srgb, ${NEWS} ${pct}%, transparent)`;

export interface PreviewFeed {
  id: string;
  name: string;
  lng: number;
  lat: number;
  embed: string;
  city?: string;
  country?: string;
  category?: string;
  url: string;
}

/** Return a safe YouTube embed URL, or null for feeds that forbid embedding. */
export function embedUrl(url: string, embedAllowed: boolean): string | null {
  if (!embedAllowed) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== 'www.youtube.com' && host !== 'youtube.com' && host !== 'www.youtube-nocookie.com') return null;
  if (!u.pathname.startsWith('/embed/')) return null;
  u.searchParams.set('autoplay', '1');
  u.searchParams.set('mute', '1');
  u.searchParams.set('playsinline', '1');
  u.searchParams.set('rel', '0');
  u.searchParams.set('modestbranding', '1');
  u.searchParams.set('enablejsapi', '1');
  return u.toString();
}

function useYouTubeError(name: string, onFail: () => void) {
  const ref = useRef<HTMLIFrameElement>(null);
  const handshake = useCallback(() => {
    ref.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: name, channel: 'widget' }),
      'https://www.youtube.com',
    );
  }, [name]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' || event.source !== ref.current?.contentWindow) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message?.event === 'onError') onFail();
      } catch { /* YouTube also posts non-JSON messages. */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onFail]);
  return { ref, handshake };
}

function Tile({ feed, onOpen, onFail }: {
  feed: PreviewFeed;
  onOpen: (feed: PreviewFeed) => void;
  onFail: (id: string) => void;
}) {
  const fail = useCallback(() => onFail(feed.id), [onFail, feed.id]);
  const { ref, handshake } = useYouTubeError(feed.id, fail);
  return (
    <div className="news-tile block w-full text-left" style={{ width: GEOM.width }}>
      <div className="relative overflow-hidden bg-black" style={{ height: GEOM.imageHeight, border: `1px solid ${news(45)}`, boxShadow: `0 0 14px ${news(18)}` }}>
        <iframe
          ref={ref}
          src={feed.embed}
          title={feed.name}
          className="h-full w-full"
          style={{ border: 0 }}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={handshake}
          onError={fail}
        />
        <button
          onClick={() => onOpen(feed)}
          title={`Open ${feed.name}`}
          aria-label={`Open ${feed.name}`}
          className="absolute right-1 top-1 z-10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em]"
          style={{ background: 'rgba(0,0,0,0.75)', border: `1px solid ${news(50)}`, color: NEWS }}
        >OPEN</button>
      </div>
      <div
        className="flex items-center gap-1.5 truncate bg-black/90 px-1.5 font-mono text-[8px] uppercase tracking-[0.12em]"
        style={{ height: GEOM.labelHeight, border: `1px solid ${news(40)}`, borderTop: 'none', color: NEWS }}
      >
        <span className="news-live-dot h-1 w-1 shrink-0 rounded-full" style={{ background: NEWS }} />
        <span className="truncate">{feed.name}</span>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <>
      <span className="news-stem news-stem-down pointer-events-none absolute left-1/2 w-px" style={{ top: TILE_H, height: GEOM.gap - 5, background: `linear-gradient(to bottom, ${news(70)}, ${news(10)})` }} />
      <span className="news-stem news-stem-up pointer-events-none absolute left-1/2 w-px" style={{ bottom: TILE_H, height: GEOM.gap - 5, background: `linear-gradient(to top, ${news(70)}, ${news(10)})` }} />
    </>
  );
}

function LiveNewsPreviews({ mapRef, active, feeds, onOpen }: {
  mapRef: React.RefObject<MlMap | null>;
  active: boolean;
  feeds: Array<Record<string, unknown>> | undefined;
  onOpen: (feed: PreviewFeed) => void;
}) {
  const [picked, setPicked] = useState<PreviewFeed[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement | null>());
  const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set());
  const onFail = useCallback((id: string) => {
    setDead(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const recompute = useCallback(() => {
    const map = mapRef.current;
    if (!map || !active || !feeds?.length || map.getZoom() < MIN_ZOOM) {
      setPicked(prev => (prev.length ? [] : prev));
      return;
    }

    const canvas = map.getCanvas();
    const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const seen = new Set<string>();
    const candidates: { feed: PreviewFeed; pt: { x: number; y: number }; d: number }[] = [];

    for (const raw of feeds) {
      const name = String(raw?.name ?? '');
      const url = String(raw?.url ?? '');
      const lng = Number(raw?.lng);
      const lat = Number(raw?.lat);
      if (!name || !url || seen.has(name) || dead.has(name) || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const embed = embedUrl(url, raw?.embed_allowed !== false && raw?.embed_allowed !== 'false');
      if (!embed) continue;
      const pt = map.project([lng, lat]);
      if (pt.x < 0 || pt.y < 0 || pt.x > viewport.width || pt.y > viewport.height) continue;
      seen.add(name);
      candidates.push({
        feed: {
          id: name, name, lng, lat, embed, url,
          city: raw?.city ? String(raw.city) : undefined,
          country: raw?.country ? String(raw.country) : undefined,
          category: raw?.category ? String(raw.category) : undefined,
        },
        pt,
        d: (pt.x - cx) ** 2 + (pt.y - cy) ** 2,
      });
    }

    candidates.sort((a, b) => a.d - b.d);
    const chosen: { feed: PreviewFeed; box: ReturnType<typeof layoutTile> }[] = [];
    for (const candidate of candidates) {
      if (chosen.length >= MAX_TILES) break;
      const box = layoutTile(candidate.pt, viewport, GEOM);
      if (chosen.some(existing => tilesOverlap(existing.box, box, GEOM))) continue;
      chosen.push({ feed: candidate.feed, box });
    }
    setPicked(prev => {
      const same = prev.length === chosen.length && prev.every((item, index) => item.id === chosen[index].feed.id);
      return same ? prev : chosen.map(item => item.feed);
    });
  }, [mapRef, active, feeds, dead]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onSourceData = (event: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (event.sourceId === 'live-news' && event.isSourceLoaded) recompute();
    };
    recompute();
    map.on('moveend', recompute);
    map.on('zoomend', recompute);
    map.on('idle', recompute);
    map.on('sourcedata', onSourceData);
    return () => {
      map.off('moveend', recompute);
      map.off('zoomend', recompute);
      map.off('idle', recompute);
      map.off('sourcedata', onSourceData);
    };
  }, [mapRef, recompute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const place = () => {
      const canvas = map.getCanvas();
      const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
      for (const feed of picked) {
        const element = nodes.current.get(feed.id);
        if (!element) continue;
        const box = layoutTile(map.project([feed.lng, feed.lat]), viewport, GEOM);
        element.dataset.flip = !box.anchored ? 'none' : box.flipped ? 'below' : 'above';
        element.style.transform = `translate3d(${Math.round(box.x)}px, ${Math.round(box.y)}px, 0)`;
      }
    };
    place();
    map.on('move', place);
    return () => { map.off('move', place); };
  }, [mapRef, picked]);

  return (
    <>
      {/* Breaking News is a separate article layer and deliberately does not
          follow the Live News Feeds toggle, which controls TV streams only. */}
      <BreakingNewsMarkers mapRef={mapRef} />
      {picked.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[39] overflow-hidden">
          {picked.map(feed => (
            <div
              key={feed.id}
              ref={element => { nodes.current.set(feed.id, element); }}
              data-flip="above"
              className="pointer-events-auto absolute left-0 top-0 will-change-transform"
              style={{ width: GEOM.width }}
            >
              <Tile feed={feed} onOpen={onOpen} onFail={onFail} />
              <Connector />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default memo(LiveNewsPreviews);
