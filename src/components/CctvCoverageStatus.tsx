'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  getCctvCoverageSnapshot,
  getCctvCoverageVersion,
  subscribeCctvCoverage,
  type ClientCctvCoverageBand,
  type ClientCctvMacroCoverage,
} from '@/lib/cctv-coverage-client';

const COLORS: Record<ClientCctvCoverageBand, string> = {
  gap: '#FF6B76',
  sparse: '#FFCA62',
  covered: '#7CCFFF',
  dense: '#5EE6A8',
};

function findDebugHeader(): HTMLElement | null {
  const section = document.querySelector('section[aria-label="OSIRIS Debug"]');
  const header = section?.querySelector(':scope > header');
  return header instanceof HTMLElement ? header : null;
}

function providerSummary(region: ClientCctvMacroCoverage) {
  const p = region.provider_counts;
  return `OCC ${p.opencctv} · W ${p.windy} · OFF ${p.official} · CUR ${p.curated}`;
}

function feedSummary(region: ClientCctvMacroCoverage) {
  const f = region.feed_counts;
  return `IMG ${f.snapshot} · HLS ${f.hls} · EMB ${f.iframe} · MJ ${f.mjpeg} · VID ${f.video}`;
}

function watchlistSummary(region: ClientCctvMacroCoverage) {
  if (!region.watchlist_total) return '—';
  const missing = region.watchlist_missing.length;
  const weak = region.watchlist_weak.length;
  return `${region.watchlist_seen}/${region.watchlist_total}${missing ? ` · ${missing} missing` : ''}${weak ? ` · ${weak} weak` : ''}`;
}

function regionTitle(region: ClientCctvMacroCoverage) {
  const lines = [
    `${region.label}: ${region.band.toUpperCase()}`,
    `${region.cameras} cameras · ${region.countries_seen} countries`,
    providerSummary(region),
    feedSummary(region),
    `Strategic watchlist: ${watchlistSummary(region)}`,
    region.watchlist_missing.length ? `Missing: ${region.watchlist_missing.join(', ')}` : undefined,
    region.watchlist_weak.length ? `Weak (<5 cams): ${region.watchlist_weak.join(', ')}` : undefined,
    region.suspected_duplicates ? `Suspected cross-source coordinate duplicates: ${region.suspected_duplicates}` : undefined,
    `Gap score: ${region.gap_score}/100`,
  ].filter(Boolean);
  return lines.join('\n');
}

export default function CctvCoverageStatus() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useSyncExternalStore(subscribeCctvCoverage, getCctvCoverageVersion, () => 0);
  const snapshots = getCctvCoverageSnapshot();
  const coverage = snapshots.global || snapshots.current;

  useEffect(() => {
    const syncTarget = () => setTarget(findDebugHeader());
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target || !target.isConnected || !coverage) return null;

  const visibleRegions = coverage.regions.filter(region => region.id !== 'other');
  const gaps = visibleRegions.filter(region => region.band === 'gap').length;
  const sparse = visibleRegions.filter(region => region.band === 'sparse').length;
  const priorityLabels = coverage.priority_regions
    .map(id => coverage.regions.find(region => region.id === id)?.label)
    .filter((label): label is string => Boolean(label));

  return createPortal(
    <details
      style={{
        width: '100%',
        marginTop: 8,
        paddingTop: 8,
        borderTop: '1px solid rgba(43,217,255,.14)',
        font: '9px ui-monospace, SFMono-Regular, Consolas, monospace',
        color: '#AFC5D8',
      }}
    >
      <summary
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          cursor: 'pointer',
          listStyle: 'none',
          userSelect: 'none',
        }}
      >
        <strong style={{ color: '#7CCFFF', letterSpacing: '.12em' }}>CCTV COVERAGE</strong>
        <span style={{ color: '#DDF3FF' }}>{coverage.scope === 'global' ? 'GLOBAL' : 'VIEW'}</span>
        <span>{coverage.total_cameras} CAM</span>
        <span>{coverage.countries_seen} COUNTRIES</span>
        {gaps > 0 && <span style={{ color: COLORS.gap }}>{gaps} GAP</span>}
        {sparse > 0 && <span style={{ color: COLORS.sparse }}>{sparse} SPARSE</span>}
        {coverage.suspected_duplicates > 0 && <span style={{ color: '#829AB0' }}>{coverage.suspected_duplicates} DUP?</span>}
        {priorityLabels.length > 0 && (
          <span style={{ marginLeft: 'auto', color: '#FFCA62' }}>PRIORITY: {priorityLabels.slice(0, 3).join(' · ')}</span>
        )}
      </summary>

      <div style={{ marginTop: 8, maxHeight: 260, overflow: 'auto', border: '1px solid rgba(43,217,255,.14)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#071321', color: '#7CCFFF' }}>
            <tr>
              {['REGION', 'STATE', 'CAMS', 'COUNTRIES', 'PROVIDERS', 'FEEDS', 'WATCHLIST', 'DUP?', 'GAP'].map(label => (
                <th key={label} style={{ textAlign: 'left', padding: '5px 6px', borderBottom: '1px solid rgba(43,217,255,.18)', fontSize: 8 }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRegions.map(region => {
              const color = COLORS[region.band];
              return (
                <tr key={region.id} title={regionTitle(region)}>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A', color: '#DDF3FF' }}>{region.label}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A', color }}>{region.band.toUpperCase()}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A' }}>{region.cameras}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A' }}>{region.countries_seen}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A' }}>{providerSummary(region)}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A' }}>{feedSummary(region)}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A', color: region.watchlist_missing.length ? '#FFCA62' : undefined }}>{watchlistSummary(region)}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A' }}>{region.suspected_duplicates || '—'}</td>
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid #101C2A', color: region.gap_score >= 50 ? '#FF6B76' : region.gap_score >= 25 ? '#FFCA62' : '#7CCFFF' }}>{region.gap_score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 5, color: '#55758E' }}>
        Strategic watchlist gaps are integration priorities, not political completeness. DUP? = suspected cross-source coordinate overlap. Latency is not used.
      </div>
    </details>,
    target,
  );
}
