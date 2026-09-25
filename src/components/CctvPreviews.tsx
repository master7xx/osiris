'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import CameraMedia from './CameraMedia';
import { snapshotUrl } from '@/lib/camera-playback';
import { type PreviewKind } from '@/lib/camera-preview';
import { layoutTile, tileHeight, tilesOverlap, type TileGeometry } from '@/lib/map-tile-layout';
import type { Map as MlMap } from 'maplibre-gl';

/** Snapshot-only map overview. Active playback belongs to CameraViewer. */

const MIN_ZOOM = 13;
const MAX_TILES = 8;


/** 16:9 frame, so nothing is letterboxed inside its own container. */
const GEOM: TileGeometry = { width: 176, imageHeight: 99, labelHeight: 20, gap: 26 };
const TILE_W = GEOM.width;
const IMG_H = GEOM.imageHeight;
const LABEL_H = GEOM.labelHeight;
const GAP = GEOM.gap;
const TILE_H = tileHeight(GEOM);

/** Placement lives in lib/map-tile-layout — the live-news tiles share it. */
function layout(pt: { x: number; y: number }, width: number, height: number) {
  return layoutTile(pt, { width, height }, GEOM);
}

/** Whatever the camera layer is currently drawn in — see lib/map-palette. */
const CAM = 'var(--map-cctv)';
/** color-mix keeps every tint tied to that property, not to a frozen hex. */
const cam = (pct: number) => `color-mix(in srgb, ${CAM} ${pct}%, transparent)`;

export interface PreviewCamera {
  id: string;
  name: string;
  lng: number;
  lat: number;
  feed_url: string;
  city?: string;
  country?: string;
  source?: string;
  stream_url?: string;
  stream_type?: string;
  external_url?: string;
  /** Resolved once during selection — see lib/camera-preview. */
  media: { kind: PreviewKind; url: string };
}

function Tile({ cam: camera, onOpen }: { cam: PreviewCamera; onOpen: (cam: PreviewCamera) => void }) {
  return (
    <button
      onClick={() => onOpen(camera)}
      title={camera.name}
      className="cctv-tile group block w-full text-left focus:outline-none"
      style={{ width: TILE_W }}
    >
      <div
        className="relative overflow-hidden bg-black"
        style={{
          height: IMG_H,
          border: `1px solid ${cam(40)}`,
          boxShadow: '0 6px 20px rgba(0,0,0,0.65)',
        }}
      >
        <CameraMedia camera={camera} overview />

        {/* Two cosmetic passes over the picture: scanlines, for the same CRT
            read the full viewer already has, and an inner vignette so a bright
            frame does not bleed into the map at its edges. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)' }}
        />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_22px_rgba(0,0,0,0.85)]" />

        {/* Corner brackets. They make the frame read as an instrument rather
            than a thumbnail, and they hold that read over any picture. */}
        {[
          'left-0 top-0 border-l border-t',
          'right-0 top-0 border-r border-t',
          'left-0 bottom-0 border-l border-b',
          'right-0 bottom-0 border-r border-b',
        ].map(pos => (
          <span
            key={pos}
            className={`pointer-events-none absolute h-2.5 w-2.5 ${pos}`}
            style={{ borderColor: cam(80) }}
          />
        ))}


      </div>

      <div
        className="flex items-center gap-1.5 truncate bg-black/90 px-1.5 font-mono text-[8px] uppercase tracking-[0.12em]"
        style={{
          height: LABEL_H,
          border: `1px solid ${cam(40)}`,
          borderTop: 'none',
          color: CAM,
        }}
      >
        <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: CAM, boxShadow: `0 0 5px ${CAM}` }} />
        <span className="truncate">{camera.name}</span>
      </div>
    </button>
  );
}

/**
 * The line from a tile to the marker it belongs to.
 *
 * Without one, eight frames float over the map with nothing saying which
 * camera each belongs to — at this zoom the dots are dense enough that the
 * nearest one is a guess. Which end it hangs from is decided by `place()`,
 * since only that knows whether the tile had room above its marker; both are
 * rendered and globals.css hides the one that does not apply.
 */
function Connector() {
  return (
    <>
      <span
        className="cctv-stem cctv-stem-down pointer-events-none absolute left-1/2 w-px"
        style={{ top: TILE_H, height: GAP - 5, background: `linear-gradient(to bottom, ${cam(70)}, ${cam(10)})` }}
      />
      <span
        className="cctv-stem cctv-stem-up pointer-events-none absolute left-1/2 w-px"
        style={{ bottom: TILE_H, height: GAP - 5, background: `linear-gradient(to top, ${cam(70)}, ${cam(10)})` }}
      />
    </>
  );
}

function CctvPreviews({ mapRef, active, onOpen }: {
  /* The ref rather than the map: reading `.current` during render is what the
     lint rule forbids, and every use here is inside an effect anyway. */
  mapRef: React.RefObject<MlMap | null>;
  active: boolean;
  onOpen: (cam: PreviewCamera) => void;
}) {
  const [cams, setCams] = useState<PreviewCamera[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement | null>());

  /** Pick which cameras get a tile. Runs only when the map settles. */
  const recompute = useCallback(() => {
    const map = mapRef.current;
    if (!map || !active || map.getZoom() < MIN_ZOOM) {
      setCams(prev => (prev.length ? [] : prev));
      return;
    }

    let feats;
    try {
      feats = map.queryRenderedFeatures({ layers: ['cctv-dots'] });
    } catch {
      return; // layer not added yet
    }

    const canvas = map.getCanvas();
    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;

    const seen = new Set<string>();
    const candidates: { cam: PreviewCamera; box: ReturnType<typeof layout>; d: number }[] = [];

    for (const f of feats) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const id = String(p.id ?? '');
      if (!id || seen.has(id)) continue;

      const str = (k: string) => (p[k] ? String(p[k]) : undefined);
      /* What this camera can actually show in a tile. Null means it needs an
         embed, or has no usable URL — either way it stays a dot. */
      const snapshot = snapshotUrl({ stream_type: str('stream_type'), feed_url: str('feed_url'), stream_url: str('stream_url') });
      const media = snapshot ? { kind: 'jpg' as const, url: snapshot } : null;
      if (!media) continue;

      const coords = (f.geometry as { coordinates?: [number, number] })?.coordinates;
      if (!coords) continue;
      seen.add(id);

      const pt = map.project(coords);
      candidates.push({
        cam: {
          id,
          name: String(p.name ?? 'CAMERA'),
          lng: coords[0],
          lat: coords[1],
          feed_url: String(p.feed_url ?? ''),
          city: str('city'),
          country: str('country'),
          source: str('source'),
          stream_url: str('stream_url'),
          stream_type: str('stream_type'),
          external_url: str('external_url'),
          media,
        },
        box: layout(pt, canvas.clientWidth, canvas.clientHeight),
        d: (pt.x - cx) ** 2 + (pt.y - cy) ** 2,
      });
    }

    /* Nearest the middle of the screen first, then drop any tile that would
       land on top of one already taken — overlapping frames read as one
       unusable smear rather than as several cameras. */
    candidates.sort((a, b) => a.d - b.d);
    const picked: typeof candidates = [];

    for (const c of candidates) {
      if (picked.length >= MAX_TILES) break;
      const clash = picked.some(p => tilesOverlap(p.box, c.box, GEOM));
      if (clash) continue;
      picked.push(c);

    }

    setCams(prev => {
      const same = prev.length === picked.length && prev.every((p, i) => p.id === picked[i].cam.id && p.feed_url === picked[i].cam.feed_url && p.stream_url === picked[i].cam.stream_url);
      return same ? prev : picked.map(p => p.cam);
    });
  }, [mapRef, active]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    /* `moveend` alone is not enough. Arriving somewhere fires it before the
       source tiles for that view have been parsed, so the query comes back
       empty and nothing would ever ask again. `idle` catches the frame after
       rendering settles, and `sourcedata` catches the camera list refreshing
       under a stationary map. */
    const onSourceData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId === 'cctv' && e.isSourceLoaded) recompute();
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

  /* Keep tiles glued to their markers without re-rendering during a pan. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const place = () => {
      const canvas = map.getCanvas();
      for (const cam of cams) {
        const el = nodes.current.get(cam.id);
        if (!el) continue;
        const box = layout(map.project([cam.lng, cam.lat]), canvas.clientWidth, canvas.clientHeight);
        /* A tile pushed back inside the viewport has been moved off its marker,
           so its connector would point at empty map. Drop the line rather than
           draw something untrue. */
        el.dataset.flip = !box.anchored ? 'none' : box.flipped ? 'below' : 'above';
        el.style.transform = `translate3d(${Math.round(box.x)}px, ${Math.round(box.y)}px, 0)`;
      }
    };
    place();
    map.on('move', place);
    return () => { map.off('move', place); };
  }, [mapRef, cams]);

  if (!cams.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[40] overflow-hidden">
      {cams.map(cam => (
        <div
          key={cam.id}
          ref={el => { nodes.current.set(cam.id, el); }}
          data-flip="above"
          className="pointer-events-auto absolute left-0 top-0 will-change-transform"
          style={{ width: TILE_W }}
        >
          <Tile cam={cam} onOpen={onOpen} />
          <Connector />
        </div>
      ))}
    </div>
  );
}

export default memo(CctvPreviews);
