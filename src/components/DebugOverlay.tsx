'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  clearDebugEvents,
  getDebugEventsSnapshot,
  getDebugEventsVersion,
  subscribeDebugEvents,
  type DebugRequestEvent,
} from '@/lib/debug-events';
import { installDebugFetch } from '@/lib/debug-fetch';
import RegionDossierStatus from '@/components/RegionDossierStatus';

type DebugMode = 'all' | 'errors' | 'slow' | 'news';
type DebugSize = 'full' | 'half' | 'third';
const DEBUG_SIZES: DebugSize[] = ['full', 'half', 'third'];
const DEBUG_HEIGHTS = { full: '86dvh', half: '50dvh', third: '33.333dvh' };
const DEBUG_SIZE_LABELS = { full: 'FULL', half: '1/2', third: '1/3' };
const BLUE = '#0788FF';
const CYAN = '#2BD9FF';
const SLOW_MS = 1000;

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

function isFailure(event: DebugRequestEvent) {
  return event.status === 'error' || event.status === 'aborted' ||
    (event.upstreams || []).some(upstream => upstream.state === 'error' || upstream.state === 'aborted');
}

function isSlow(event: DebugRequestEvent) {
  return Number(event.durationMs || 0) >= SLOW_MS ||
    (event.upstreams || []).some(upstream => Number(upstream.durationMs || 0) >= SLOW_MS);
}

function isNews(event: DebugRequestEvent) {
  if (/\/api\/(news|live-news|gdelt-events)/.test(event.endpoint)) return true;
  return (event.upstreams || []).some(upstream =>
    /bbc|guardian|aljazeera|euronews|t\.me|gdelt/i.test(`${upstream.host} ${upstream.url}`),
  );
}

export default function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<DebugMode>('all');
  const [size, setSize] = useState<DebugSize>('full');
  const nextSize = DEBUG_SIZES[(DEBUG_SIZES.indexOf(size) + 1) % DEBUG_SIZES.length];
  const [now, setNow] = useState(() => Date.now());

  useSyncExternalStore(subscribeDebugEvents, getDebugEventsVersion, () => 0);

  useEffect(() => installDebugFetch(), []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
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
  const filtered = events.filter(event => {
    if (needle && !`${event.endpoint} ${event.error || ''} ${(event.upstreams || []).map(u => `${u.host} ${u.url} ${u.error || ''}`).join(' ')}`.toLowerCase().includes(needle)) return false;
    if (mode === 'errors' && !isFailure(event)) return false;
    if (mode === 'slow' && !isSlow(event)) return false;
    if (mode === 'news' && !isNews(event)) return false;
    return true;
  });

  const failures = events.filter(isFailure).length;
  const pending = events.filter(event => event.status === 'pending').length;
  const slow = events.filter(isSlow).length;
  const newsCount = events.filter(isNews).length;

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

  const filterButton = (value: DebugMode, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      style={{
        border: `1px solid ${mode === value ? 'rgba(43,217,255,.85)' : 'rgba(80,120,160,.30)'}`,
        background: mode === value ? 'rgba(7,136,255,.20)' : 'rgba(6,17,30,.7)',
        color: mode === value ? '#DDF8FF' : '#7791AA',
        padding: '5px 8px', borderRadius: 4, cursor: 'pointer', font: '10px ui-monospace, SFMono-Regular, Consolas, monospace',
        boxShadow: mode === value ? '0 0 12px rgba(7,136,255,.22)' : 'none',
      }}
    >{label}{count !== undefined ? ` ${count}` : ''}</button>
  );

  return (
    <>
      <RegionDossierStatus />
      <style jsx global>{`
        @keyframes osiris-debug-run { 0%,100% { box-shadow: 0 0 18px rgba(7,136,255,.6), 0 0 36px rgba(7,136,255,.25); } 50% { box-shadow: 0 0 28px rgba(43,217,255,.9), 0 0 52px rgba(7,136,255,.4); } }
      `}</style>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        title="OSIRIS Debug request monitor (Ctrl+Shift+D)"
        aria-pressed={open}
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 2147483000,
          border: '1px solid rgba(143,225,255,.95)',
          background: `linear-gradient(180deg, ${CYAN} 0%, ${BLUE} 42%, #005DD7 100%)`,
          color: '#FFFFFF', padding: '10px 16px', borderRadius: 7,
          font: '700 12px ui-monospace, SFMono-Regular, Consolas, monospace',
          letterSpacing: '.12em', cursor: 'pointer', opacity: 1,
          boxShadow: '0 0 20px rgba(7,136,255,.7), 0 0 42px rgba(7,136,255,.28), inset 0 1px 0 rgba(255,255,255,.35)',
          animation: pending ? 'osiris-debug-run 1.1s ease-in-out infinite' : undefined,
        }}
      >
        ◉ DEBUG{pending ? ` · ${pending} RUN` : ''}{failures ? ` · ${failures} ERR` : ''}
      </button>

      {open && (
        <section
          aria-label="OSIRIS Debug"
          style={{
            position: 'fixed', left: '3vw', right: '3vw', bottom: '7dvh', height: DEBUG_HEIGHTS[size],
            minHeight: 'min(260px, 86dvh)', maxHeight: '86dvh',
            zIndex: 2147482999, display: 'flex', flexDirection: 'column',
            background: 'rgba(3,10,20,.975)', border: `1px solid ${CYAN}`,
            boxShadow: '0 0 0 1px rgba(7,136,255,.45), 0 0 38px rgba(7,136,255,.30), 0 28px 90px rgba(0,0,0,.72)',
            color: '#E8F4FF', font: '12px ui-monospace, SFMono-Regular, Consolas, monospace', borderRadius: 6,
          }}
        >
          <header style={{ flexShrink: 0, maxHeight: '50%', overflow: 'auto', padding: '10px 12px', borderBottom: '1px solid rgba(43,217,255,.32)', background: 'linear-gradient(90deg, rgba(7,136,255,.18), rgba(3,10,20,.2))' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, alignItems: 'center' }}>
              <strong style={{ letterSpacing: '.14em', color: CYAN, fontSize: 13 }}>OSIRIS / DEBUG</strong>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: pending ? CYAN : '#29E58C', boxShadow: `0 0 9px ${pending ? CYAN : '#29E58C'}` }} />
              <span style={{ color: '#8EA9C0' }}>{events.length} requests · {pending} pending · {failures} failed · {slow} slow</span>
              <input
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="endpoint / upstream / error"
                aria-label="Filter debug endpoints"
                style={{ marginLeft: 'auto', width: 260, maxWidth: '100%', background: '#06111E', border: '1px solid rgba(43,217,255,.36)', color: '#E8F4FF', padding: '6px 8px', borderRadius: 4 }}
              />
              <button
                type="button"
                onClick={() => setSize(nextSize)}
                aria-label={`Debug window size: ${DEBUG_SIZE_LABELS[size]}. Switch to ${DEBUG_SIZE_LABELS[nextSize]}`}
                title={`Switch to ${DEBUG_SIZE_LABELS[nextSize]} height`}
                style={{ color: CYAN, border: '1px solid rgba(43,217,255,.5)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >SIZE: {DEBUG_SIZE_LABELS[size]}</button>
              <button onClick={exportLog} style={{ color: CYAN }}>EXPORT</button>
              <button onClick={clearAll} style={{ color: CYAN }}>CLEAR</button>
              <button onClick={() => setOpen(false)} style={{ color: '#FFF' }}>CLOSE</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
              {filterButton('all', 'ALL', events.length)}
              {filterButton('errors', 'ERRORS', failures)}
              {filterButton('slow', 'SLOW >1s', slow)}
              {filterButton('news', 'NEWS', newsCount)}
            </div>
          </header>

          <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#071321', color: '#7CCFFF', zIndex: 2 }}>
                <tr>
                  {['TIME', 'STATUS', 'METHOD', 'ENDPOINT / UPSTREAM', 'DURATION', 'SINCE PREV', 'REQUEST ID', 'SERVER TIMING / ERROR'].map(label => (
                    <th key={label} style={{ textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid rgba(43,217,255,.24)', letterSpacing: '.08em', fontSize: 9 }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap(event => {
                  const elapsed = event.status === 'pending' ? Math.max(0, now - event.startedAt) : event.durationMs;
                  const failed = event.status === 'error' || event.status === 'aborted';
                  const slowMain = Number(elapsed || 0) >= SLOW_MS;
                  const main = (
                    <tr key={event.id} style={{ background: failed ? 'rgba(127,29,29,.18)' : slowMain ? 'rgba(120,78,10,.12)' : undefined }}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #132234' }}>{new Date(event.startedAt).toLocaleTimeString()}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #132234', color: failed ? '#FF7B86' : event.status === 'pending' ? CYAN : '#5EE6A8' }}>{statusLabel(event)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #132234' }}>{event.method}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #132234', color: isNews(event) ? '#9EEBFF' : '#E8F4FF' }}>{event.endpoint}{event.upstreams?.length ? ` · ${event.upstreams.length} upstream` : ''}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #132234', color: slowMain ? '#FFCA62' : undefined }}>{formatMs(elapsed)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #132234' }}>{formatMs(event.gapMs)}</td>
                      <td title={event.correlationId} style={{ padding: '6px 8px', borderBottom: '1px solid #132234' }}>{event.correlationId.slice(-12)}</td>
                      <td title={event.error || event.serverTiming} style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', padding: '6px 8px', borderBottom: '1px solid #132234', color: failed ? '#FF7B86' : '#718DA8' }}>{event.error || event.serverTiming || '—'}</td>
                    </tr>
                  );
                  const upstreamRows = (event.upstreams || []).map(upstream => {
                    const upstreamFailed = upstream.state === 'error' || upstream.state === 'aborted';
                    const upstreamSlow = Number(upstream.durationMs || 0) >= SLOW_MS;
                    return (
                      <tr key={`${event.id}:${upstream.id}`} style={{ color: upstreamFailed ? '#FF8791' : '#8CA7BE', background: upstreamFailed ? 'rgba(127,29,29,.22)' : '#050E19' }}>
                        <td style={{ padding: '4px 8px 4px 22px', borderBottom: '1px solid #101C2A' }}>{new Date(upstream.startedAt).toLocaleTimeString()}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #101C2A', color: upstreamFailed ? '#FF8791' : '#5EE6A8' }}>{upstream.status ?? upstream.state.toUpperCase()}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #101C2A' }}>{upstream.method}</td>
                        <td title={upstream.url} style={{ padding: '4px 8px 4px 22px', borderBottom: '1px solid #101C2A', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis' }}>↳ {upstreamLabel(upstream.url, upstream.host)}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #101C2A', color: upstreamSlow ? '#FFCA62' : undefined }}>{formatMs(upstream.durationMs)}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #101C2A' }}>—</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #101C2A' }}>server</td>
                        <td title={upstream.error} style={{ padding: '4px 8px', borderBottom: '1px solid #101C2A', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>{upstream.error || '—'}</td>
                      </tr>
                    );
                  });
                  return [main, ...upstreamRows];
                })}
              </tbody>
            </table>
          </div>
          <footer style={{ flexShrink: 0, flexWrap: 'wrap', gap: 4, padding: '8px 10px', borderTop: '1px solid rgba(43,217,255,.22)', color: '#66829A', display: 'flex', justifyContent: 'space-between' }}>
            <span>Query strings, bodies, auth/cookies and request headers are not stored.</span>
            <span style={{ color: '#6FAFD8' }}>Ctrl+Shift+D · upstream correlation enabled</span>
          </footer>
        </section>
      )}
    </>
  );
}
