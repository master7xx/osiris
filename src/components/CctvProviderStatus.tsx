'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  getCctvProviderHealthSnapshot,
  getCctvProviderHealthVersion,
  subscribeCctvProviderHealth,
  type ClientCctvProviderHealth,
  type ClientCctvProviderState,
} from '@/lib/cctv-health-client';

const COLORS: Record<ClientCctvProviderState, string> = {
  healthy: '#5EE6A8',
  partial: '#FFCA62',
  error: '#FF6B76',
  disabled: '#60758A',
  idle: '#6FAFD8',
};

function findDebugHeader(): HTMLElement | null {
  const section = document.querySelector('section[aria-label="OSIRIS Debug"]');
  const header = section?.querySelector(':scope > header');
  return header instanceof HTMLElement ? header : null;
}

function formatMs(value?: number) {
  if (value === undefined) return '—';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function providerTitle(provider: ClientCctvProviderHealth) {
  const lines = [
    `${provider.label}: ${provider.state.toUpperCase()}`,
    `Enabled: ${provider.enabled ? 'yes' : 'no'}`,
    `Cameras in current response: ${provider.response_cameras}`,
    `Cameras across observed scopes: ${provider.cameras}`,
    `Longest observed refresh: ${formatMs(provider.duration_ms)} (diagnostic only)`,
    provider.last_success_at ? `Last OK: ${provider.last_success_at}` : undefined,
    provider.last_error ? `Last error: ${provider.last_error}` : undefined,
  ].filter(Boolean) as string[];

  for (const scope of provider.scopes) {
    lines.push(
      `${scope.scope}: ${scope.state.toUpperCase()} · ${scope.cameras} cams · ${formatMs(scope.duration_ms)}${scope.last_error ? ` · ${scope.last_error}` : ''}`,
    );
  }
  return lines.join('\n');
}

export default function CctvProviderStatus() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useSyncExternalStore(subscribeCctvProviderHealth, getCctvProviderHealthVersion, () => 0);
  const providers = getCctvProviderHealthSnapshot();

  useEffect(() => {
    const syncTarget = () => setTarget(findDebugHeader());
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target || !target.isConnected || providers.length === 0) return null;

  return createPortal(
    <div
      aria-label="CCTV provider health"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 7,
        marginTop: 9,
        paddingTop: 8,
        borderTop: '1px solid rgba(43,217,255,.18)',
        font: '9px ui-monospace, SFMono-Regular, Consolas, monospace',
      }}
    >
      <strong style={{ color: '#7CCFFF', letterSpacing: '.12em', marginRight: 2 }}>CCTV PROVIDERS</strong>
      {providers.map(provider => {
        const color = COLORS[provider.state];
        const state = provider.state === 'disabled' ? 'OFF' : provider.state.toUpperCase();
        return (
          <span
            key={provider.id}
            title={providerTitle(provider)}
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
            <b style={{ color: '#DDF3FF', fontWeight: 700 }}>{provider.label.toUpperCase()}</b>
            <span>{provider.response_cameras} CAM</span>
            <span style={{ color }}>{state}</span>
          </span>
        );
      })}
      <span style={{ color: '#55758E', marginLeft: 'auto' }}>duration = telemetry only, never health penalty</span>
    </div>,
    target,
  );
}
