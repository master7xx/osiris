'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  getNewsSourceHealth,
  getNewsSourceHealthVersion,
  subscribeNewsSourceHealth,
} from '@/lib/news-health-client';

const BLUE = '#0788FF';
const CYAN = '#2BD9FF';

function stateColor(state: 'healthy' | 'degraded' | 'cooldown') {
  if (state === 'healthy') return '#5EE6A8';
  if (state === 'degraded') return '#FFCA62';
  return '#FF7B86';
}

export default function NewsHealthBadge() {
  const [open, setOpen] = useState(false);
  useSyncExternalStore(subscribeNewsSourceHealth, getNewsSourceHealthVersion, () => 0);

  const health = getNewsSourceHealth();
  if (!health.length) return null;

  const healthy = health.filter(source => source.state === 'healthy').length;
  const degraded = health.filter(source => source.state === 'degraded').length;
  const cooldown = health.filter(source => source.state === 'cooldown').length;
  const sorted = [...health].sort((a, b) => {
    const rank = { cooldown: 0, degraded: 1, healthy: 2 } as const;
    return rank[a.state] - rank[b.state] || a.effective_weight - b.effective_weight;
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        title="News source health"
        style={{
          position: 'fixed', right: 18, bottom: 70, zIndex: 2147482998,
          border: `1px solid ${degraded || cooldown ? '#FFCA62' : 'rgba(43,217,255,.75)'}`,
          background: 'rgba(3,10,20,.94)', color: '#DDF8FF', padding: '7px 10px', borderRadius: 6,
          font: '700 10px ui-monospace, SFMono-Regular, Consolas, monospace', letterSpacing: '.08em',
          boxShadow: degraded || cooldown ? '0 0 16px rgba(255,202,98,.18)' : '0 0 14px rgba(7,136,255,.18)',
          cursor: 'pointer',
        }}
      >
        NEWS {healthy}/{health.length}{degraded ? ` · ${degraded} DEG` : ''}{cooldown ? ` · ${cooldown} COOL` : ''}
      </button>

      {open && (
        <section
          aria-label="News source health"
          style={{
            position: 'fixed', right: 18, bottom: 108, width: 560, maxHeight: '55vh', overflow: 'auto', zIndex: 2147482998,
            background: 'rgba(3,10,20,.98)', border: `1px solid ${CYAN}`, borderRadius: 6,
            boxShadow: '0 0 28px rgba(7,136,255,.24), 0 22px 65px rgba(0,0,0,.62)',
            color: '#DDEBFA', font: '10px ui-monospace, SFMono-Regular, Consolas, monospace',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: '1px solid rgba(43,217,255,.24)' }}>
            <strong style={{ color: CYAN, letterSpacing: '.12em' }}>NEWS SOURCE HEALTH</strong>
            <span style={{ color: '#718DA8' }}>{healthy} healthy · {degraded} degraded · {cooldown} cooldown</span>
            <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: 'auto', color: '#FFF' }}>CLOSE</button>
          </header>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#071321', color: '#7CCFFF' }}>
              <tr>
                {['SOURCE', 'TIER', 'STATE', 'WEIGHT', 'SUCCESS', 'AVG', 'ITEMS', 'DETAIL'].map(label => (
                  <th key={label} style={{ textAlign: 'left', padding: '6px 7px', borderBottom: '1px solid #183047', fontSize: 9 }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(source => (
                <tr key={source.id} style={{ background: source.state === 'cooldown' ? 'rgba(127,29,29,.14)' : source.state === 'degraded' ? 'rgba(120,78,10,.10)' : undefined }}>
                  <td style={{ padding: '6px 7px', borderBottom: '1px solid #132234' }}>{source.name}</td>
                  <td style={{ padding: '6px 7px', borderBottom: '1px solid #132234', color: '#7F9BB3' }}>{source.tier}</td>
                  <td style={{ padding: '6px 7px', borderBottom: '1px solid #132234', color: stateColor(source.state), fontWeight: 700 }}>{source.state.toUpperCase()}</td>
                  <td style={{ padding: '6px 7px', borderBottom: '1px solid #132234' }}>{source.effective_weight.toFixed(2)} / {source.weight.toFixed(2)}</td>
                  <td style={{ padding: '6px 7px', borderBottom: '1px solid #132234' }}>{Math.round(source.success_rate * 100)}%</td>
                  <td style={{ padding: '6px 7px', borderBottom: '1px solid #132234' }}>{source.avg_latency_ms || source.duration_ms} ms</td>
                  <td style={{ padding: '6px 7px', borderBottom: '1px solid #132234' }}>{source.items}</td>
                  <td title={source.last_error || source.error || source.cooldown_until} style={{ maxWidth: 165, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '6px 7px', borderBottom: '1px solid #132234', color: '#718DA8' }}>
                    {source.cooldown_until ? `until ${new Date(source.cooldown_until).toLocaleTimeString()}` : source.last_error || source.error || (source.empty_streak ? `empty x${source.empty_streak}` : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer style={{ padding: '7px 10px', color: '#66829A', borderTop: '1px solid rgba(43,217,255,.18)' }}>
            Adaptive weight recovers after successful probes. Cooldown prevents repeatedly failing sources from delaying every news refresh.
          </footer>
        </section>
      )}
    </>
  );
}
