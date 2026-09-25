'use client';
import { useState } from 'react';
import { X, ExternalLink, MapPin, Maximize2 } from 'lucide-react';
import CameraMedia from './CameraMedia';
import { nearbyCameras, type PlaybackCamera } from '@/lib/camera-playback';
interface CameraViewerProps {
  camera: (PlaybackCamera & { city?: string; country?: string }) | null;
  cameras?: PlaybackCamera[];
  onClose: () => void;
  onLocate?: (lat: number, lng: number) => void;
}
export default function CameraViewer({ camera, cameras = [], onClose, onLocate }: CameraViewerProps) {
  const [fullscreen, setFullscreen] = useState(false);
  if (!camera) return null;
  const neighbors = nearbyCameras(camera, cameras);
  const source = camera.external_url || camera.stream_url || camera.feed_url;
  return <section aria-label="Camera viewing area" data-expanded={fullscreen} className={`camera-viewer fixed z-[10000] flex flex-col overflow-auto border border-[var(--border-primary)] bg-black/95 text-white shadow-2xl ${fullscreen ? 'inset-4' : 'bottom-[70px] left-2 right-2 max-h-[80vh] md:bottom-6 md:left-auto md:right-6 md:w-[560px]'}`}>
    <header className="flex items-center gap-2 border-b border-white/20 p-3">
      <div className="min-w-0 flex-1"><h2 className="truncate text-xs font-mono">{camera.name}</h2><p className="text-[10px] text-white/60">{camera.source} · {camera.city} {camera.country}</p></div>
      <button title="Locate camera" onClick={() => { if (camera.lat != null && camera.lng != null) onLocate?.(camera.lat, camera.lng); }}><MapPin size={16} /></button>
      <button title="Toggle fullscreen" onClick={() => setFullscreen(!fullscreen)}><Maximize2 size={16} /></button>
      <button title="Close cameras" onClick={onClose}><X size={20} /></button>
    </header>
    <div className={`min-h-0 ${fullscreen ? 'flex-1' : 'aspect-video'}`}><CameraMedia key={camera.id || source} camera={camera} /></div>
    {neighbors.length > 0 && <div className="border-t border-white/20 p-2">
      <p className="mb-2 text-[10px] text-white/60">NEARBY · WITHIN 2 KM · {neighbors.length + 1}/4 CAMERAS</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{neighbors.map(c => <div key={c.id}><div className="aspect-video"><CameraMedia camera={c} /></div><p className="truncate text-[9px]">{c.name}</p></div>)}</div>
    </div>}
    <footer className="flex justify-between border-t border-white/20 p-2 text-[10px] text-white/60"><span>Direct playback · clips are not continuous live video</span>{source && <a href={source} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">SOURCE <ExternalLink size={12} /></a>}</footer>
  </section>;
}
