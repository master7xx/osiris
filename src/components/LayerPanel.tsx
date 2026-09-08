'use client';

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plane, Satellite, Sun, AlertTriangle, Camera, CloudLightning, Ship,
  Network, Ghost, Megaphone, SlidersHorizontal, Bug, Newspaper,
} from 'lucide-react';
import StyleStudio from './StyleStudio';

interface LayerPanelProps {
  data: any;
  activeLayers: any;
  setActiveLayers: React.Dispatch<React.SetStateAction<any>>;
  isMobile?: boolean;
  theme?: 'core' | 'ghost';
  setTheme?: (theme: 'core' | 'ghost') => void;
  capabilities?: Record<string, boolean>;
}

interface LayerDef {
  key: string;
  label: string;
  dataKey: string;
  catKey?: string;
  requires?: string;
  parent?: string;
}

interface LayerGroupDef {
  label: string;
  fullLabel: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  layers: LayerDef[];
}

const GROUPS: LayerGroupDef[] = [
  { label: 'SDK', fullLabel: 'OSIRIS SDK', icon: Network, layers: [
    { key: 'sdk_sea', label: 'Maritime Lines', dataKey: 'sdk_entities' },
  ]},
  { label: 'AVIATION', fullLabel: 'AVIATION', icon: Plane, layers: [
    { key: 'flights', label: 'Commercial', dataKey: 'commercial_flights' },
    { key: 'private', label: 'Private', dataKey: 'private_flights' },
    { key: 'jets', label: 'Private Jets', dataKey: 'private_jets' },
    { key: 'military', label: 'Military', dataKey: 'military_flights' },
  ]},
  { label: 'MARITIME', fullLabel: 'MARITIME', icon: Ship, layers: [
    { key: 'maritime', label: 'Maritime / Naval', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' },
  ]},
  { label: 'SPACE', fullLabel: 'SPACE TRACKING', icon: Satellite, layers: [
    { key: 'satellites', label: 'All Satellites', dataKey: 'satellites' },
    { key: 'sat_comms', label: 'Starlink / Comms', dataKey: 'satellites', catKey: 'comms' },
    { key: 'sat_military', label: 'Military / Intel', dataKey: 'satellites', catKey: 'military' },
    { key: 'sat_navigation', label: 'GPS / Navigation', dataKey: 'satellites', catKey: 'navigation' },
    { key: 'sat_earth', label: 'Earth Observation', dataKey: 'satellites', catKey: 'earth_obs' },
    { key: 'sat_science', label: 'Stations / Telescopes', dataKey: 'satellites', catKey: 'science' },
  ]},
  { label: 'SURVEIL', fullLabel: 'SURVEILLANCE & NEWS', icon: Camera, layers: [
    { key: 'cctv', label: 'CCTV Cameras', dataKey: 'cameras' },
    { key: 'cctv_previews', label: 'Live Previews', dataKey: '', parent: 'cctv' },
    // Reuses the existing gdelt-events MapLibre renderer, now backed by the
    // geolocated multi-source breaking-news endpoint.
    { key: 'gdelt_events', label: 'Breaking News', dataKey: 'gdelt_events' },
    { key: 'live_news', label: 'Live News Feeds', dataKey: 'live_feeds' },
  ]},
  { label: 'HAZARD', fullLabel: 'NATURAL HAZARDS', icon: CloudLightning, layers: [
    { key: 'earthquakes', label: 'Earthquakes', dataKey: 'earthquakes' },
    { key: 'fires', label: 'Active Fires', dataKey: 'fires' },
    { key: 'weather', label: 'Severe Weather', dataKey: 'weather_events' },
  ]},
  { label: 'THREAT', fullLabel: 'THREATS & INTEL', icon: AlertTriangle, layers: [
    { key: 'infrastructure', label: 'Nuclear Facilities', dataKey: 'infrastructure' },
    { key: 'global_incidents', label: 'Global Incidents', dataKey: 'gdelt' },
  ]},
  { label: 'NETWORK', fullLabel: 'NETWORK INTEL', icon: Network, layers: [
    { key: 'malware', label: 'Live Malware', dataKey: 'malware_threats' },
    { key: 'cyber_attacks', label: 'Live Attacks', dataKey: 'cyber_attacks' },
  ]},
  { label: 'NETINTEL', fullLabel: 'NET & EVENT INTEL', icon: Megaphone, layers: [
    { key: 'cf_outages', label: 'Internet Outages', dataKey: 'cf_outages', requires: 'cloudflare' },
    { key: 'cf_attacks', label: 'Attack Origins', dataKey: 'cf_attack_origins', requires: 'cloudflare' },
  ]},
  { label: 'DISPLAY', fullLabel: 'DISPLAY', icon: Sun, layers: [
    { key: 'day_night', label: 'Day / Night Cycle', dataKey: '' },
    { key: 'terrain_3d', label: '3D Terrain & Buildings', dataKey: '' },
  ]},
];

function Toggle({ active, blue = false }: { active: boolean; blue?: boolean }) {
  const on = blue ? '#008CFF' : 'rgba(255,255,255,.88)';
  return (
    <span className="relative flex-shrink-0 block" style={{ width: 30, height: 15 }}>
      <span className="absolute inset-0 rounded-full transition-all" style={{
        border: active ? `1px solid ${on}` : '1px solid rgba(255,255,255,.14)',
        background: active ? (blue ? 'rgba(0,140,255,.22)' : 'rgba(255,255,255,.16)') : 'transparent',
        boxShadow: active && blue ? '0 0 10px rgba(0,140,255,.45)' : 'none',
      }} />
      <motion.span
        className="absolute top-[2px] rounded-full"
        style={{ width: 11, height: 11, background: active ? on : 'rgba(255,255,255,.22)' }}
        animate={{ left: active ? 17 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </span>
  );
}

function SubStem() {
  return <span aria-hidden className="pointer-events-none absolute left-[7px] top-0 h-1/2 w-[8px] rounded-bl-[3px] border-b border-l border-white/[0.14]" />;
}

function LayerPanel({ data, activeLayers, setActiveLayers, isMobile, theme = 'core', setTheme, capabilities = {} }: LayerPanelProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  useEffect(() => {
    try { setDebugOpen(localStorage.getItem('osiris:debug-open') === '1'); } catch { /* ignore */ }
    const onState = (event: Event) => setDebugOpen(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    window.addEventListener('osiris-debug-state', onState);
    return () => window.removeEventListener('osiris-debug-state', onState);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPinned(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);

  const visibleGroups = GROUPS.map(group => ({
    ...group,
    layers: group.layers.filter(layer => !layer.requires || capabilities[layer.requires]),
  })).filter(group => group.layers.length);

  const toggle = (key: string) => setActiveLayers((previous: any) => ({ ...previous, [key]: !previous[key] }));
  const toggleDebug = () => window.dispatchEvent(new Event('osiris-debug-toggle'));

  const count = (dataKey: string, catKey?: string): number | null => {
    if (!dataKey) return null;
    if (catKey && data.category_counts) return data.category_counts[catKey] || 0;
    let total = 0; let found = false;
    for (const key of dataKey.split(',')) if (Array.isArray(data[key])) { total += data[key].length; found = true; }
    return found ? total : null;
  };

  const layerRow = (layer: LayerDef, mobile = false) => {
    const active = Boolean(activeLayers[layer.key]);
    const dormant = Boolean(layer.parent && !activeLayers[layer.parent]);
    const news = layer.key === 'gdelt_events';
    const n = count(layer.dataKey, layer.catKey);
    return (
      <button
        key={layer.key}
        onClick={() => toggle(layer.key)}
        aria-pressed={active}
        className={`relative w-full flex items-center gap-3 rounded-md text-left hover:bg-white/[0.05] transition-colors ${mobile ? 'py-2' : 'py-1.5'} ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40' : ''}`}
      >
        {layer.parent && <SubStem />}
        <Toggle active={active} blue={news} />
        <span className="text-[11px] font-mono uppercase tracking-wider flex-1" style={{ color: active ? (news ? '#56c5ff' : 'rgba(255,255,255,.76)') : 'rgba(255,255,255,.36)' }}>
          {news && <Newspaper className="inline w-3 h-3 mr-1.5 -mt-px" />} {layer.label}
        </span>
        {n !== null && <span className="text-[10px] font-mono tabular-nums text-white/25">{n.toLocaleString()}</span>}
      </button>
    );
  };

  if (isMobile) {
    return (
      <div className="flex flex-col gap-5 py-2">
        {visibleGroups.map(group => (
          <div key={group.label} className="flex flex-col gap-1">
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/30 border-b border-white/[0.06] pb-1.5 mb-1">{group.fullLabel}</div>
            {group.layers.map(layer => layerRow(layer, true))}
          </div>
        ))}
        <div className="pt-3 border-t border-[#008cff]/20">
          <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-[#4abaff]/70 mb-2">SYSTEM</div>
          <button onClick={toggleDebug} className="w-full flex items-center gap-3 py-2 px-1 rounded hover:bg-[#008cff]/10">
            <Toggle active={debugOpen} blue />
            <Bug className="w-3.5 h-3.5 text-[#42b9ff]" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#67c8ff]">Debug Overlay</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ x: -60, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200, delay: 2.8 }}
      className="absolute top-0 left-0 h-full w-[48px] flex flex-col items-center pt-24 pb-6 z-50 pointer-events-auto"
      style={{ background: 'rgba(0,0,0,.18)', backdropFilter: 'blur(24px) saturate(1.2)' }}
    >
      <div className="flex-1 flex flex-col items-center gap-1">
        {visibleGroups.map(group => {
          const activeCount = group.layers.filter(layer => !layer.parent && activeLayers[layer.key]).length;
          const isOpen = hovered === group.label || pinned === group.label;
          const Icon = group.icon;
          return (
            <div key={group.label} className="relative flex items-center justify-center" onMouseEnter={() => setHovered(group.label)} onMouseLeave={() => setHovered(null)}>
              <button
                onClick={() => setPinned(pinned === group.label ? null : group.label)}
                title={group.fullLabel}
                className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/[0.05] focus:outline-none"
              >
                <Icon className="w-4 h-4" style={{ color: activeCount ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.24)' }} />
                {activeCount > 0 && <span className="absolute top-1 right-1 min-w-[13px] h-[13px] px-[3px] rounded-full flex items-center justify-center text-[9px] font-mono bg-[#00e5ff] text-black shadow-[0_0_6px_rgba(0,229,255,.5)]">{activeCount}</span>}
              </button>
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }}
                    className="absolute left-[52px] top-1/2 -translate-y-1/2 min-w-[235px] rounded-xl p-3 z-[100]"
                    style={{ background: 'rgba(0,5,12,.84)', backdropFilter: 'blur(38px)', border: '1px solid rgba(70,155,220,.12)', boxShadow: '0 10px 38px rgba(0,0,0,.62)' }}
                  >
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/[0.05]">
                      <span className="text-[10px] font-mono tracking-[.18em] uppercase text-white/40 flex-1">{group.fullLabel}</span>
                      {pinned === group.label && <button onClick={() => setPinned(null)} className="text-white/35 hover:text-white text-xs">✕</button>}
                    </div>
                    <div className="flex flex-col gap-0.5">{group.layers.map(layer => layerRow(layer))}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="w-5 h-px bg-white/[0.06] my-2" />

      <div className="relative" onMouseEnter={() => setHovered('SYSTEM')} onMouseLeave={() => setHovered(null)}>
        <button
          onClick={toggleDebug}
          title="Debug Overlay"
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-all"
          style={{ background: debugOpen ? 'rgba(0,140,255,.18)' : 'transparent', boxShadow: debugOpen ? 'inset 0 0 14px rgba(0,140,255,.15)' : 'none' }}
        >
          <Bug className="w-4 h-4" style={{ color: debugOpen ? '#42b9ff' : 'rgba(66,185,255,.48)', filter: debugOpen ? 'drop-shadow(0 0 6px #008cff)' : 'none' }} />
        </button>
        <AnimatePresence>
          {hovered === 'SYSTEM' && (
            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }} className="absolute left-[52px] bottom-0 w-[220px] rounded-xl p-3 z-[100]" style={{ background: 'rgba(0,5,12,.9)', border: '1px solid rgba(0,140,255,.28)', boxShadow: '0 0 24px rgba(0,140,255,.15)' }}>
              <div className="text-[10px] font-mono tracking-[.2em] text-[#4abaff]/70 border-b border-[#008cff]/15 pb-2 mb-2">SYSTEM</div>
              <button onClick={toggleDebug} className="w-full flex items-center gap-3 py-1.5 rounded hover:bg-[#008cff]/10">
                <Toggle active={debugOpen} blue />
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#67c8ff]">Debug Overlay</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button onClick={() => setStudioOpen(value => !value)} className="w-10 h-10 flex items-center justify-center rounded-lg" title="Style Studio">
        <SlidersHorizontal className="w-4 h-4" style={{ color: studioOpen ? 'var(--gold-primary)' : 'rgba(255,255,255,.18)' }} />
      </button>
      <AnimatePresence>{studioOpen && <StyleStudio onClose={() => setStudioOpen(false)} />}</AnimatePresence>

      {setTheme && (
        <button onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')} className="w-10 h-10 flex items-center justify-center rounded-lg" title="Ghost Protocol">
          <Ghost className="w-4 h-4" style={{ color: theme === 'ghost' ? '#B388FF' : 'rgba(255,255,255,.18)' }} />
        </button>
      )}
    </motion.div>
  );
}

export default memo(LayerPanel);
