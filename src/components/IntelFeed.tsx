'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Newspaper, ChevronDown, ChevronUp, ExternalLink, MapPin, Zap } from 'lucide-react';

interface IntelFeedProps {
  data: any;
  onLocate?: (lat: number, lng: number) => void;
}

function getRiskClass(score: number): string {
  if (score >= 8) return 'risk-critical';
  if (score >= 6) return 'risk-high';
  if (score >= 4) return 'risk-medium';
  return 'risk-low';
}

function getRiskLabel(score: number): string {
  if (score >= 8) return 'CRITICAL';
  if (score >= 6) return 'HIGH';
  if (score >= 4) return 'ELEVATED';
  return 'LOW';
}

function timeAgo(dateStr: string): string {
  const time = Date.parse(dateStr);
  if (!Number.isFinite(time)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function absoluteTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function zuluTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}Z`;
}

export default function IntelFeed({ data, onLocate }: IntelFeedProps) {
  const [expanded, setExpanded] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [liveNews, setLiveNews] = useState<any[]>(() => data.news || []);
  const [sourceStatus, setSourceStatus] = useState<{ healthy: number; total: number } | null>(null);

  useEffect(() => {
    if (Array.isArray(data.news) && data.news.length) setLiveNews(data.news);
  }, [data.news]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;

    const refresh = async () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/news', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        if (stopped) return;
        if (Array.isArray(payload.news)) setLiveNews(payload.news);
        setSourceStatus({ healthy: Number(payload.healthy_sources || 0), total: Number(payload.source_count || 0) });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('[OSIRIS] SIGINT refresh failed:', error instanceof Error ? error.message : error);
        }
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 120_000);
    const onVisibility = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const news = liveNews;
  const highConfidence = useMemo(() => news.filter((item: any) => item.confidence === 'high').length, [news]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.6, duration: 0.6 }}
      className="glass-panel flex flex-col overflow-hidden pointer-events-auto"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-4 py-3 hover:bg-[var(--hover-accent)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
          <span className="hud-text text-[11px] text-[var(--text-primary)]">SIGINT FEED</span>
          <span className="gotham-tag gotham-tag--info" style={{ fontSize: '9px', padding: '1px 5px' }}>{news.length}</span>
          {news.some((item: any) => item.risk_score >= 8) && (
            <span className="gotham-tag gotham-tag--critical" style={{ fontSize: '9px', padding: '1px 4px' }}>ALERTS</span>
          )}
          {highConfidence > 0 && (
            <span className="text-[8px] font-mono text-cyan-300/60">{highConfidence} CORROBORATED</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sourceStatus && <span className="text-[8px] font-mono text-[var(--text-muted)]">SRC {sourceStatus.healthy}/{sourceStatus.total}</span>}
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--alert-green)] animate-osiris-pulse" />
          {expanded ? <ChevronUp className="w-3 h-3 text-[var(--text-muted)]" /> : <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="max-h-[440px] overflow-y-auto styled-scrollbar divide-y divide-[var(--border-secondary)]">
              {news.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <span className="text-[10px] font-mono text-[var(--text-muted)] tracking-widest">AWAITING INTELLIGENCE...</span>
                </div>
              ) : news.slice(0, 30).map((item: any, index: number) => {
                const sources: string[] = Array.isArray(item.sources) && item.sources.length ? item.sources : [item.source].filter(Boolean);
                return (
                  <div
                    key={item.id || `${item.link || 'news'}-${index}`}
                    role="button"
                    tabIndex={0}
                    className="px-4 py-2.5 hover:bg-[var(--hover-accent)] transition-colors cursor-pointer"
                    onClick={() => { if (item.link) window.open(item.link, '_blank', 'noopener,noreferrer'); else setSelectedIdx(selectedIdx === index ? null : index); }}
                    onKeyDown={(event) => { if (event.key === 'Enter' && item.link) window.open(item.link, '_blank', 'noopener,noreferrer'); }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-mono font-bold tracking-widest ${getRiskClass(item.risk_score)}`}>{getRiskLabel(item.risk_score)}</span>
                      {sources.slice(0, 2).map(source => (
                        <span key={source} className="text-[8px] font-mono text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">{source}</span>
                      ))}
                      {sources.length > 2 && <span className="text-[8px] font-mono text-cyan-300/70">+{sources.length - 2}</span>}
                      {item.coords && (
                        <button
                          onClick={(event) => { event.stopPropagation(); onLocate?.(item.coords[0], item.coords[1]); }}
                          className="text-[var(--text-muted)] hover:text-[var(--cyan-primary)] transition-colors"
                          title={item.location || 'Locate on map'}
                        ><MapPin className="w-2.5 h-2.5" /></button>
                      )}
                    </div>

                    <h4 className="text-[10px] text-[var(--text-primary)] leading-tight line-clamp-2">{item.title}</h4>
                    <div className="mt-1 flex items-center gap-1.5 text-[8px] font-mono text-[var(--text-muted)]">
                      <span className="text-cyan-300/80">{timeAgo(item.published)}</span>
                      <span>·</span>
                      <span>{absoluteTime(item.published)}</span>
                      <span>·</span>
                      <span>{zuluTime(item.published)}</span>
                      {item.confidence && <><span>·</span><span>{String(item.confidence).toUpperCase()} CONF</span></>}
                    </div>

                    {item.machine_assessment && (
                      <div className="mt-1.5 flex items-start gap-1.5 bg-red-950/20 border border-red-900/20 rounded px-2 py-1">
                        <Zap className="w-2.5 h-2.5 text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="text-[10px] font-mono text-red-400/80 leading-relaxed">{item.machine_assessment}</span>
                      </div>
                    )}

                    <AnimatePresence>
                      {selectedIdx === index && item.link && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 overflow-hidden">
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-mono text-[var(--cyan-primary)] hover:underline" onClick={(event) => event.stopPropagation()}>
                            <ExternalLink className="w-2.5 h-2.5" /> OPEN SOURCE
                          </a>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
