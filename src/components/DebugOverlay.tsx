'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bug, Download, Trash2, X, Minimize2 } from 'lucide-react';
import {
  clearDebugEvents,
  getDebugEventsSnapshot,
  getDebugEventsVersion,
  subscribeDebugEvents,
  type DebugRequestEvent,
} from '@/lib/debug-events';
import { installDebugFetch } from '@/lib/debug-fetch';

const DEBUG_STATE_EVENT = 'osiris-debug-state';
const DEBUG_TOGGLE_EVENT = 'osiris-debug-toggle';
const DEBUG_STORAGE_KEY = 'osiris:debug-open';
const BLUE = '#008CFF';

function formatMs(value?: number) {
  if (value === undefined) return '—';
  return value < 1000 ? `${value.toFixed(0)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function upstreamLabel(url: string, host: string) {
  try { return `${host}${new URL(url).pathname}`; } catch { return url; }
}

function statusLabel(event: DebugRequestEvent) {
  if (event.status === 'pending') return 'RUN';
  if (event.status === 'ok') return String(event.httpStatus ?? 'OK');
  if (event.status === 'aborted') return 'ABORT';
  return event.httpStatus ? String(event.httpStatus) : 'ERR';
}

function statusColor(status: string, httpStatus?: number) {
  if (status === 'pending') return '#ffd166';
  if (status === 'ok' && (!httpStatus || httpStatus < 400)) return '#4de88b';
  return '#ff5468';
}

export default function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [, setTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useSyncExternalStore(subscribeDebugEvents, getDebugEventsVersion, () => 0);

  useEffect(() => installDebugFetch(), []);
  useEffect(() => {
    try { if (localStorage.getItem(DEBUG_STORAGE_KEY) === '1') setOpen(true); } catch { /* storage unavailable */ }
    const toggle = () => setOpen(value => !value);
    window.addEventListener(DEBUG_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(DEBUG_TOGGLE_EVENT, toggle);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(DEBUG_STORAGE_KEY, open ? '1' : '0'); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent(DEBUG_STATE_EVENT, { detail: { open } }));
  }, [open]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const events = getDebugEventsSnapshot();
  const needle = filter.trim().toLowerCase();
  const filtered = needle ? events.filter(event => event.endpoint.toLowerCase().includes(needle)) : events;
  const failures = events.filter(event => event.status === 'error' || event.status === 'aborted').length;
  const pending = events.filter(event => event.status === 'pending').length;
  const completed = events.filter(event => event.durationMs !== undefined);
  const average = completed.length ? completed.reduce((sum, event) => sum + (event.durationMs || 0), 0) / completed.length : 0;

  useEffect(() => {
    if (open && autoScroll && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [events.length, open, autoScroll]);

  async function clearAll() {
    clearDebugEvents();
    try { await fetch('/api/debug/events', { method: 'DELETE', cache: 'no-store' }); } catch { /* optional server store */ }
  }

  function exportLog() {
    const payload = { exportedAt: new Date().toISOString(), userAgent: navigator.userAgent, events: getDebugEventsSnapshot() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `osiris-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  const buttonColor = failures ? '#ff3152' : BLUE;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        title="OSIRIS Debug Monitor (Ctrl+Shift+D)"
        aria-pressed={open}
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 2147483000,
          display: 'flex', alignItems: 'center', gap: 9,
          border: `1px solid ${buttonColor}`, background: buttonColor,
          color: '#fff', padding: '10px 16px', borderRadius: 7,
          font: '700 13px ui-monospace, SFMono-Regular, Consolas, monospace',
          letterSpacing: '.08em', cursor: 'pointer',
          boxShadow: `0 0 8px ${buttonColor}, 0 0 26px ${buttonColor}99, inset 0 1px 0 rgba(255,255,255,.28)`,
          textShadow: '0 1px 2px rgba(0,0,0,.45)',
        }}
      >
        <Bug size={17} />
        DEBUG
        {(pending > 0 || failures > 0) && (
          <span style={{ fontSize: 10, background: 'rgba(0,0,0,.32)', borderRadius: 10, padding: '2px 6px' }}>
            {pending ? `${pending} RUN` : ''}{pending && failures ? ' · ' : ''}{failures ? `${failures} ERR` : ''}
          </span>
        )}
      </button>

      {open && (
        <section
          aria-label="OSIRIS Debug"
          style={{
            position: 'fixed', left: '17vw', right: '23vw', bottom: 72, height: '38vh', minHeight: 300,
            zIndex: 2147482999, display: 'flex', flexDirection: 'column',
            background: 'rgba(2,8,18,.96)', border: `1px solid ${BLUE}`,
            borderRadius: 8, boxShadow: `0 0 10px ${BLUE}aa, 0 0 38px ${BLUE}55, 0 24px 80px rgba(0,0,0,.75)`,
            color: '#dcecff', font: '11px ui-monospace, SFMono-Regular, Consolas, monospace',
            overflow: 'hidden', backdropFilter: 'blur(18px)',
          }}
        >
          <header style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid rgba(0,140,255,.35)', background: 'linear-gradient(90deg,rgba(0,140,255,.16),rgba(0,140,255,.025))' }}>
            <Bug size={15} color="#42b9ff" />
            <strong style={{ color: '#42b9ff', letterSpacing: 1.5, fontSize: 13 }}>OSIRIS / DEBUG</strong>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#4de88b', fontSize: 9, letterSpacing: 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4de88b', boxShadow: '0 0 8px #4de88b' }} /> LIVE REQUEST MONITOR
            </span>
            <input
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder="FILTER /api/..."
              aria-label="Filter debug endpoints"
              style={{ marginLeft: 'auto', width: 190, background: '#07111e', border: '1px solid rgba(0,140,255,.32)', borderRadius: 4, color: '#dcecff', padding: '5px 7px', font: 'inherit' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: '#7891ac' }}>
              AUTO
              <input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} />
            </label>
            <button onClick={exportLog} title="Export JSON" style={{ background: 'transparent', border: 0, color: '#7dbde8', cursor: 'pointer' }}><Download size={14} /></button>
            <button onClick={clearAll} title="Clear" style={{ background: 'transparent', border: 0, color: '#7dbde8', cursor: 'pointer' }}><Trash2 size={14} /></button>
            <button onClick={() => setOpen(false)} title="Minimize" style={{ background: 'transparent', border: 0, color: '#7dbde8', cursor: 'pointer' }}><Minimize2 size={14} /></button>
            <button onClick={() => setOpen(false)} title="Close" style={{ background: 'transparent', border: 0, color: '#7dbde8', cursor: 'pointer' }}><X size={14} /></button>
          </header>

          <div ref={bodyRef} style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap', tableLayout: 'fixed' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#07111e', zIndex: 2 }}>
                <tr>
                  {[['TIME',10],['STATUS',8],['METHOD',8],['ENDPOINT / UPSTREAM',31],['DURATION',11],['SINCE PREV',11],['REQUEST ID',13],['ERROR',18]].map(([label,width]) => (
                    <th key={String(label)} style={{ width: `${width}%`, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid rgba(0,140,255,.24)', color: '#7292ad', fontWeight: 600 }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap(event => {
                  const elapsed = event.status === 'pending' ? Date.now() - event.startedAt : event.durationMs;
                  const color = statusColor(event.status, event.httpStatus);
                  const cell = { padding: '5px 8px', borderBottom: '1px solid rgba(65,110,145,.14)', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
                  const main = (
                    <tr key={event.id} style={{ background: event.status === 'error' ? 'rgba(255,40,70,.07)' : 'transparent' }}>
                      <td style={cell}>{new Date(event.startedAt).toLocaleTimeString(undefined, { hour12: false })}</td>
                      <td style={{ ...cell, color }}><span style={{ marginRight: 5 }}>●</span>{statusLabel(event)}</td>
                      <td style={cell}>{event.method}</td>
                      <td style={{ ...cell, color: '#cde9ff', fontWeight: 700 }}>{event.endpoint}{event.upstreams?.length ? ` · ${event.upstreams.length} upstream` : ''}</td>
                      <td style={cell}>{formatMs(elapsed)}</td>
                      <td style={cell}>{formatMs(event.gapMs)}</td>
                      <td title={event.correlationId} style={cell}>{event.correlationId.slice(-12)}</td>
                      <td title={event.error || event.serverTiming} style={{ ...cell, color: event.error ? '#ff6b7d' : '#698198' }}>{event.error || event.serverTiming || '—'}</td>
                    </tr>
                  );
                  const upstreamRows = (event.upstreams || []).map(upstream => {
                    const upstreamColor = statusColor(upstream.state, upstream.status);
                    return (
                      <tr key={`${event.id}:${upstream.id}`} style={{ color: '#7e9bb5', background: upstream.state === 'error' ? 'rgba(255,40,70,.10)' : 'rgba(0,140,255,.018)' }}>
                        <td style={cell}>↳ {new Date(upstream.startedAt).toLocaleTimeString(undefined, { hour12: false })}</td>
                        <td style={{ ...cell, color: upstreamColor }}><span style={{ marginRight: 5 }}>●</span>{upstream.status ?? upstream.state.toUpperCase()}</td>
                        <td style={cell}>{upstream.method}</td>
                        <td title={upstream.url} style={{ ...cell, paddingLeft: 18 }}>{upstreamLabel(upstream.url, upstream.host)}</td>
                        <td style={cell}>{formatMs(upstream.durationMs)}</td>
                        <td style={cell}>—</td>
                        <td style={cell}>server</td>
                        <td title={upstream.error} style={{ ...cell, color: upstream.error ? '#ff6b7d' : '#597187' }}>{upstream.error || 'upstream_ok'}</td>
                      </tr>
                    );
                  });
                  return [main, ...upstreamRows];
                })}
              </tbody>
            </table>
          </div>

          <footer style={{ padding: '6px 10px', borderTop: '1px solid rgba(0,140,255,.24)', display: 'flex', justifyContent: 'space-between', color: '#65839e', background: '#050d17' }}>
            <span>{events.length} requests · <b style={{ color: '#4de88b' }}>{events.length - failures} OK</b> · <b style={{ color: failures ? '#ff5468' : '#65839e' }}>{failures} failed</b></span>
            <span>Avg: {formatMs(average)} · query strings / bodies / auth are never stored · Ctrl+Shift+D</span>
          </footer>
        </section>
      )}
    </>
  );
}
