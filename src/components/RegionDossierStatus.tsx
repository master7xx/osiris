'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type SourceState = 'ok' | 'timeout' | 'error' | 'skipped';

interface DossierSource {
  state: SourceState;
  duration_ms?: number;
  error?: string;
}

interface DossierStatusDetail {
  partial?: boolean;
  sources?: Record<string, DossierSource>;
}

const LABELS: Record<string, string> = {
  nominatim: 'GEO',
  rest_countries: 'BASE',
  wikipedia: 'WIKI',
  wikidata: 'WD',
};

const COLORS: Record<SourceState, string> = {
  ok: '#5EE6A8',
  timeout: '#FFCA62',
  error: '#FF6B76',
  skipped: '#60758A',
};

function findDossierHeader(): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll('h2'));
  const heading = headings.find(node => node.textContent?.trim() === 'REGION DOSSIER');
  return heading?.parentElement instanceof HTMLElement ? heading.parentElement : null;
}

export default function RegionDossierStatus() {
  const [detail, setDetail] = useState<DossierStatusDetail | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const syncTarget = () => setTarget(findDossierHeader());
    syncTarget();

    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    const onStatus = (event: Event) => {
      const custom = event as CustomEvent<DossierStatusDetail>;
      setDetail(custom.detail || null);
      queueMicrotask(syncTarget);
    };
    window.addEventListener('osiris:region-dossier-status', onStatus as EventListener);

    return () => {
      observer.disconnect();
      window.removeEventListener('osiris:region-dossier-status', onStatus as EventListener);
    };
  }, []);

  const sources = detail?.sources || {};
  const entries = useMemo(() => Object.entries(sources), [sources]);
  if (!target || !target.isConnected || !detail || !entries.length) return null;

  const ok = entries.filter(([, source]) => source.state === 'ok').length;
  const title = entries
    .map(([key, source]) => `${LABELS[key] || key.toUpperCase()}: ${source.state.toUpperCase()}${source.error ? ` — ${source.error}` : ''}`)
    .join('\n');

  return createPortal(
    <div className="ml-auto mr-2 flex items-center gap-1.5 font-mono" title={title}>
      <span
        className="rounded border px-1.5 py-0.5 text-[8px] font-bold tracking-[0.14em]"
        style={{
          color: detail.partial ? '#FFCA62' : '#5EE6A8',
          borderColor: detail.partial ? 'rgba(255,202,98,.55)' : 'rgba(94,230,168,.55)',
          background: detail.partial ? 'rgba(255,202,98,.08)' : 'rgba(94,230,168,.08)',
        }}
      >
        {detail.partial ? 'PARTIAL' : 'FULL'} {ok}/{entries.length}
      </span>
      <span className="flex items-center gap-1" aria-label="Region dossier source status">
        {entries.map(([key, source]) => (
          <span
            key={key}
            className="flex items-center gap-0.5 text-[7px] tracking-[0.08em] text-[var(--text-muted)]"
            title={`${LABELS[key] || key}: ${source.state}`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: COLORS[source.state], boxShadow: `0 0 5px ${COLORS[source.state]}` }}
            />
            {LABELS[key] || key.slice(0, 4).toUpperCase()}
          </span>
        ))}
      </span>
    </div>,
    target,
  );
}
