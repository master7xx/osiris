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

function formatMs(value?: number) {
  if (value === undefined) return '—';
  return value < 1000 ? `${value.toFixed(0)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function upstreamLabel(url: string, host: string) {
  try {
    return `${host}${new URL(url).pathname}`;
  } catch {
    return url;
  }
}

function statusLabel(event: DebugRequestEvent) {
  if (event.status === 'pending') return 'RUN';
  if (event.status === 'ok') return String(event.httpStatus ?? 'OK');
  if (event.status === 'aborted') return 'ABORT';
  return event.httpStatus ? String(event.httpStatus) : 'ERR';
}

export default function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [, setTick] = useState(0);

  useSyncExternalStore(subscribeDebugEvents, getDebugEventsVersion, () => 0);

  useEffect(() => installDebugFetch(), []);
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

  async function clearAll() {
    clearDebugEvents();
    try {
      await fetch('/api/debug/events', { method: 'DELETE', cache: 'no-store' });
    } catch {
      // Server debug storage is optional.
    }
  }

  function exportLog() {
    const payload = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      events: getDebugEventsSnapshot(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `osiris-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        title="Debug requests (Ctrl+Shift+D)"
        style={{
          position: 'fixed', right: 12, bottom: 12, zIndex: 2147483000,
          border: '1px solid #6b7280', background: '#09090b', color: failures ? '#fca5a5' : '#d1d5db',
          padding: '6px 9px', borderRadius: 4, font: '11px ui-monospace, SFMono-Regular, Consolas, monospace',
          opacity: .9, cursor: 'pointer',
        }}
      >
        DEBUG {pending ? `· ${pending} RUN` : ''} {failures ? `· ${failures} ERR` : ''}
      </button>

      {open && (
        <section
          aria-label="OSIRIS Debug"
          style={{
            position: 'fixed', inset: '8vh 3vw 7vh', zIndex: 2147482999, display: 'flex',
            flexDirection: 'column', background: 'rgba(3,7,18,.97)', border: '1px solid #374151',
            boxShadow: '0 20px 80px rgba(0,0,0,.65)', color: '#e5e7eb',
            font: '12px ui-monospace, SFMono-Regular, Consolas, monospace',
          }}
        >
          <header style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderBottom: '1px solid #374151' }}>
            <strong style={{ letterSpacing: 1 }}>OSIRIS / DEBUG</strong>
            <span>{events.length} requests · {pending} pending · {failures} failed</span>
            <input
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder="/api/..."
              aria-label="Filter debug endpoints"
              style={{ marginLeft: 'auto', width: 220, background: '#111827', border: '1px solid #4b5563', color: '#fff', padding: 5 }}
            />
            <button onClick={exportLog}>EXPORT JSON</button>
            <button onClick={clearAll}>CLEAR</button>
            <button onClick={() => setOpen(false)}>CLOSE</button>
          </header>
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#111827' }}>
                <tr>
                  {['TIME', 'STATUS', 'METHOD', 'ENDPOINT / UPSTREAM', 'DURATION', 'SINCE PREV', 'REQUEST ID', 'SERVER TIMING / ERROR'].map(label => (
                    <th key={label} style={{ textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid #374151' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap(event => {
                  const elapsed = event.status === 'pending' ? Date.now() - event.startedAt : event.durationMs;
                  const main = (
                    <tr key={event.id}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>{new Date(event.startedAt).toLocaleTimeString()}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>{statusLabel(event)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>{event.method}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>
                        {event.endpoint}{event.upstreams?.length ? ` · ${event.upstreams.length} upstream` : ''}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>{formatMs(elapsed)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>{formatMs(event.gapMs)}</td>
                      <td title={event.correlationId} style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>{event.correlationId.slice(-12)}</td>
                      <td title={event.error || event.serverTiming} style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>
                        {event.error || event.serverTiming || '—'}
                      </td>
                    </tr>
                  );
                  const upstreamRows = (event.upstreams || []).map(upstream => (
                    <tr key={`${event.id}:${upstream.id}`} style={{ color: upstream.state === 'ok' ? '#9ca3af' : '#fca5a5', background: '#070b14' }}>
                      <td style={{ padding: '4px 8px 4px 22px', borderBottom: '1px solid #111827' }}>{new Date(upstream.startedAt).toLocaleTimeString()}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #111827' }}>{upstream.status ?? upstream.state.toUpperCase()}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #111827' }}>{upstream.method}</td>
                      <td title={upstream.url} style={{ padding: '4px 8px 4px 22px', borderBottom: '1px solid #111827', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis' }}>↳ {upstreamLabel(upstream.url, upstream.host)}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #111827' }}>{formatMs(upstream.durationMs)}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #111827' }}>—</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #111827' }}>server</td>
                      <td title={upstream.error} style={{ padding: '4px 8px', borderBottom: '1px solid #111827', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>{upstream.error || '—'}</td>
                    </tr>
                  ));
                  return [main, ...upstreamRows];
                })}
              </tbody>
            </table>
          </div>
          <footer style={{ padding: 8, borderTop: '1px solid #374151', color: '#9ca3af' }}>
            Query strings, request bodies and headers are not stored. Upstream rows are server-side fetches correlated to the API request. Ctrl+Shift+D toggles this overlay.
          </footer>
        </section>
      )}
    </>
  );
}
