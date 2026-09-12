'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  getEventIngestHealthSnapshot,
  getEventIngestHealthVersion,
  subscribeEventIngestHealth,
  type ClientEventSourceHealth,
  type ClientEventSourceState,
} from '@/lib/event-health-client';

const COLORS: Record<ClientEventSourceState, string> = {
  healthy: '#5EE6A8',
  partial: '#FFCA62',
  error: '#FF6B76',
};

function findDebugHeader(): HTMLElement | null {
  const section = document.querySelector('section[aria-label="OSIRIS Debug"]');
  const header = section?.querySelector(':scope > header');
  return header instanceof HTMLElement ? header : null;
}

function formatMs(value: number) {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function sourceTitle(source: ClientEventSourceHealth) {
  return [
    `${source.label}: ${source.state.toUpperCase()}`,
    `Events contributed: ${source.events}`,
    `Logical sources: ${source.healthy_sources}/${source.source_count}`,
    `Request duration: ${formatMs(source.duration_ms)} (diagnostic only)`,
    source.error ? `Detail: ${source.error}` : undefined,
  ].filter(Boolean).join('\n');
}

export default function EventIngestStatus() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useSyncExternalStore(subscribeEventIngestHealth, getEventIngestHealthVersion, () => 0);
  const snapshot = getEventIngestHealthSnapshot();

  useEffect(() => {
    const syncTarget = () => setTarget(findDebugHeader());
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target || !target.isConnected || !snapshot) return null;

  const errorCount = snapshot.source_health.filter(source => source.state === 'error').length;
  const partialCount = snapshot.source_health.filter(source => source.state === 'partial').length;
  const categorySummary = Object.entries(snapshot.categories)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => `${category}:${count}`)
    .join(' · ');

  return createPortal(
    <div
      aria-label="Unified event ingest health"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 7,
        width: '100%',
        marginTop: 9,
        paddingTop: 8,
        borderTop: '1px solid rgba(43,217,255,.18)',
        font: '9px ui-monospace, SFMono-Regular, Consolas, monospace',
      }}
    >
      <strong
        title={[
          `Unified events: ${snapshot.total}`,
          `Mappable: ${snapshot.mappable}`,
          `Confirmed: ${snapshot.confirmed}`,
          `Corroborating: ${snapshot.corroborating}`,
          `Unconfirmed: ${snapshot.unconfirmed}`,
          categorySummary ? `Categories: ${categorySummary}` : undefined,
          snapshot.generated_at ? `Generated: ${snapshot.generated_at}` : undefined,
        ].filter(Boolean).join('\n')}
        style={{ color: '#7CCFFF', letterSpacing: '.12em', marginRight: 2 }}
      >
        EVENT INGEST
      </strong>
      <span style={{ color: '#DDF3FF' }}>{snapshot.total} EVT</span>
      <span>{snapshot.mappable} MAP</span>
      <span style={{ color: '#5EE6A8' }}>{snapshot.confirmed} CONF</span>
      <span style={{ color: '#7CCFFF' }}>{snapshot.healthy_sources}/{snapshot.source_count} SRC</span>
      {partialCount > 0 && <span style={{ color: COLORS.partial }}>{partialCount} PARTIAL</span>}
      {errorCount > 0 && <span style={{ color: COLORS.error }}>{errorCount} ERROR</span>}

      {snapshot.source_health.map(source => {
        const color = COLORS[source.state];
        return (
          <span
            key={source.id}
            title={sourceTitle(source)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 6px',
              border: `1px solid ${color}55`,
              borderRadius: 4,
              background: `${color}10`,
              color: '#AFC5D8',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: color, boxShadow: `0 0 5px ${color}` }} />
            <b style={{ color: '#DDF3FF', fontWeight: 700 }}>{source.label.toUpperCase()}</b>
            <span>{source.events} EVT</span>
            <span style={{ color }}>{source.state.toUpperCase()}</span>
          </span>
        );
      })}

      <span style={{ color: '#55758E', marginLeft: 'auto' }}>duration = telemetry only, never health penalty</span>
    </div>,
    target,
  );
}
