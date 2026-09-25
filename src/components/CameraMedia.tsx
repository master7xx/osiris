'use client';
import { useEffect, useRef, useState } from 'react';
import { clipUrl, mediaErrorLabel, snapshotUrl, type PlaybackCamera } from '@/lib/camera-playback';
import { localEmbed, needsResolution, liveFeedAtSource } from '@/lib/camera-feed';

/** Unmounting this component releases the network connection and decoder. */
export default function CameraMedia({ camera, overview = false }: { camera: PlaybackCamera; overview?: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible ? <MediaSession key={`${camera.id}:${camera.stream_url}:${camera.feed_url}:${overview}`} camera={camera} overview={overview} />
    : <div className="relative h-full w-full bg-black"><span className="absolute right-2 top-2 text-xs text-amber-300">PAUSED · HIDDEN</span></div>;
}
function MediaSession({ camera, overview }: { camera: PlaybackCamera; overview: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState('CONNECTING');
  const [revision, setRevision] = useState(0);
  const [resolution, setResolution] = useState<{ embed?: string; kind?: string }>();
  const [check, setCheck] = useState<{ state: string; httpStatus?: number; checkedAt?: string }>();
  const snapshot = snapshotUrl(camera);
  const resolveUrl = !overview && (needsResolution(camera) || liveFeedAtSource(camera)) ? camera.external_url : undefined;
  const embed = localEmbed(camera) || resolution?.embed;
  const kind = overview ? 'jpg' : embed ? 'iframe' : (camera.stream_type || 'jpg').toLowerCase();
  const url = overview ? snapshot : embed || camera.stream_url || snapshot;
  const unavailable = ['offline', 'missing'].includes(resolution?.kind || '');
  useEffect(() => {
    if (!resolveUrl) return;
    const controller = new AbortController();
    fetch(`/api/cctv/resolve?url=${encodeURIComponent(resolveUrl)}`, { signal: controller.signal }).then(r => r.json()).then(d => {
      setResolution({ embed: d.embeddable ? d.embedUrl : undefined, kind: d.kind });
    }).catch(() => {});
    return () => controller.abort();
  }, [resolveUrl]);
  useEffect(() => {
    if (!camera.id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/cctv/diagnostics?id=${encodeURIComponent(camera.id!)}`, { signal: controller.signal });
        if (response.ok) { const data = await response.json(); if (!controller.signal.aborted) setCheck(data.checks?.[0]); }
      } catch { /* Metadata failure never interrupts media. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 30000);
    };
    // Avoid requests for StrictMode probes and tiles removed during a quick pan.
    timer = setTimeout(poll, 150);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [camera.id]);
  useEffect(() => {
    if (overview || !['mp4', 'jpg'].includes(kind) || !url) return;
    // Conservative clip refresh; never append arbitrary parameters to signed URLs.
    const timer = setInterval(() => setRevision(Date.now()), kind === 'mp4' ? 300000 : 30000);
    return () => clearInterval(timer);
  }, [kind, url, overview]);
  useEffect(() => {
    const el = video.current;
    if (!el || !url || !['mp4', 'hls'].includes(kind)) return;
    let cancelled = false;
    let hls: { destroy(): void } | undefined;
    const play = () => { void el.play().catch(() => { if (!cancelled) setState('CLICK TO PLAY'); }); };
    const timeout = setTimeout(() => { if (!cancelled && el.readyState < 2) setState('TIMEOUT'); }, 15000);
    if (kind === 'mp4') { el.src = clipUrl(url, revision); el.load(); play(); }
    else {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const instance = new Hls({ enableWorker: false, maxBufferLength: 10, backBufferLength: 0 }); hls = instance;
          instance.on(Hls.Events.MANIFEST_PARSED, play);
          instance.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setState('MEDIA'); });
          instance.loadSource(url); instance.attachMedia(el);
        } else if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; play(); }
        else setState('UNSUPPORTED');
      }).catch(() => { if (!cancelled) setState('MEDIA'); });
    }
    return () => { cancelled = true; clearTimeout(timeout); hls?.destroy(); el.pause(); el.removeAttribute('src'); el.load(); };
  }, [kind, url, revision]);
  useEffect(() => {
    if (!url || kind !== 'jpg') return;
    const timer = setTimeout(() => setState(old => old === 'CONNECTING' ? 'TIMEOUT' : old), 15000);
    return () => clearTimeout(timer);
  }, [url, kind, revision]);
  const label = unavailable ? 'OFFLINE AT SOURCE' : !url ? (resolveUrl && !resolution ? 'RESOLVING' : 'EXTERNAL') : state;
  const failed = ['NETWORK', 'DECODE', 'UNSUPPORTED', 'MEDIA', 'LOAD FAILED', 'OFFLINE AT SOURCE'].includes(label);
  const color = failed ? 'text-red-300' : label === 'PLAYING' ? 'text-green-300' : ['LOADED', 'EMBED LOADED'].includes(label) ? 'text-sky-300' : 'text-amber-300';
  const format = kind === 'mp4' ? 'CLIP' : kind === 'jpg' ? 'SNAPSHOT' : kind.toUpperCase();
  return <div className="relative h-full w-full bg-black text-white">
    {!unavailable && url && (kind === 'mp4' || kind === 'hls' ? <video ref={video} className={`h-full w-full object-contain ${failed && snapshot ? 'opacity-0' : ''}`} muted playsInline controls loop={kind === 'mp4'}
      onPlaying={() => setState('PLAYING')} onWaiting={() => setState('BUFFERING')} onPause={() => setState('PAUSED')} onError={() => setState(mediaErrorLabel(video.current?.error?.code))} />
      : kind === 'iframe' ? <iframe src={url} title={camera.name || 'Camera'} className="h-full w-full border-0" allow="autoplay; fullscreen" allowFullScreen onLoad={() => setState('EMBED LOADED')} />
      // eslint-disable-next-line @next/next/no-img-element -- provider image; no server media storage
      : <img key={revision} src={clipUrl(url, revision)} alt="" aria-label={camera.name || 'Camera'} className={`h-full w-full object-contain ${failed ? 'opacity-0' : ''}`} onLoad={() => setState('LOADED')} onError={() => setState('LOAD FAILED')} />)}
    {!overview && failed && snapshot && ['mp4', 'hls'].includes(kind) && <>
      {/* eslint-disable-next-line @next/next/no-img-element -- fallback still from provider */}
      <img src={snapshot} alt="Source snapshot fallback" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      <span className="absolute bottom-1 left-1 bg-black/80 text-[9px] text-sky-300">SNAPSHOT FALLBACK · FRESHNESS UNVERIFIED</span>
    </>}
    <div className={`absolute right-1 top-1 z-30 max-w-[95%] truncate rounded-sm bg-black/75 px-1.5 py-0.5 text-[9px] font-mono ${color}`} role="status"
      title={`${format} · ${label}\n${check ? `SERVER ${check.httpStatus ? `HTTP ${check.httpStatus}` : check.state} · ${check.checkedAt || 'not checked'}` : 'Server check pending'}\nServer HEAD does not verify playback or capture time.`}>
      {format} · {label}{failed && check?.httpStatus && check.httpStatus >= 400 ? ` · SERVER ${check.httpStatus}` : ''}
    </div>
    {!overview && camera.external_url && <a href={camera.external_url} target="_blank" rel="noopener noreferrer" className="absolute bottom-9 left-2 z-30 bg-black/80 px-2 text-xs text-sky-300">Open source</a>}
    {!overview && (failed || label === 'TIMEOUT') && <button className="absolute bottom-9 right-2 z-30 bg-black/80 px-2 text-xs" onClick={() => { setState('CONNECTING'); setRevision(Date.now()); }}>Retry</button>}
  </div>;
}
