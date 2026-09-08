'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Newspaper, ChevronDown, ChevronUp, ExternalLink, MapPin, Zap, RefreshCw } from 'lucide-react';

interface IntelFeedProps {
  data: any;
  onLocate?: (lat: number, lng: number) => void;
}

function riskColor(score: number) {
  if (score >= 8) return '#ff4d67';
  if (score >= 6) return '#ff9d2e';
  if (score >= 4) return '#ffd166';
  return '#55e087';
}

function riskLabel(score: number) {
  if (score >= 8) return 'HIGH';
  if (score >= 6) return 'ELEV';
  if (score >= 4) return 'MED';
  return 'LOW';
}

function timeAgo(dateStr: string) {
  const ms = Date.now() - Date.parse(dateStr);
  if (!Number.isFinite(ms)) return '—';
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function absoluteDate(dateStr: string) {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function IntelFeed({ data, onLocate }: IntelFeedProps) {
  const [expanded, setExpanded] = useState(true);
  const [liveNews, setLiveNews] = useState<any[] | null>(null);
  const [sourceSummary, setSourceSummary] = useState<{ healthy: number; total: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'all' | 'breaking'>('all');

  const refresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/news', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (Array.isArray(payload.news)) setLiveNews(payload.news);
      if (payload.source_summary) setSourceSummary(payload.source_summary);
    } catch {
      // Keep the last good payload on transient network failure.
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(refresh, 120_000);
    return () => window.clearInterval(timer);
  }, []);

  const news = liveNews ?? data.news ?? [];
  const visible = useMemo(() => (
    tab === 'breaking' ? news.filter((item: any) => (item.age_minutes ?? 9999) < 120 || item.risk_score >= 8) : news
  ), [news, tab]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.6, duration: 0.6 }}
      className="glass-panel flex flex-col overflow-hidden pointer-events-auto"
      style={{ borderColor: 'rgba(0,140,255,.18)' }}
    >
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between px-4 py-3 hover:bg-[var(--hover-accent)] transition-colors">
        <div className="flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5" style={{ color: '#25a7ff' }} />
          <span className="hud-text text-[11px] text-[var(--text-primary)]">SIGINT FEED</span>
          <span className="text-[9px] font-mono rounded px-1.5 py-0.5" style={{ color: '#53c2ff', background: 'rgba(0,140,255,.12)' }}>{news.length}</span>
          <span className="flex items-center gap-1 text-[8px] font-mono tracking-widest" style={{ color: '#55e087' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#55e087', boxShadow: '0 0 8px #55e087' }} /> LIVE
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            role="button"
            tabIndex={0}
            title="Refresh now"
            onClick={(event) => { event.stopPropagation(); refresh(); }}
            className="p-1 rounded hover:bg-white/5"
          >
            <RefreshCw className={`w-3 h-3 text-[var(--text-muted)] ${refreshing ? 'animate-spin' : ''}`} />
          </span>
          {expanded ? <ChevronUp className="w-3 h-3 text-[var(--text-muted)]" /> : <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="flex border-y border-white/[0.05] bg-black/20">
              {(['all', 'breaking'] as const).map(value => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className="flex-1 py-2 text-[9px] font-mono tracking-widest uppercase"
                  style={{
                    color: tab === value ? '#56c5ff' : 'rgba(255,255,255,.35)',
                    borderBottom: tab === value ? '1px solid #008cff' : '1px solid transparent',
                    background: tab === value ? 'rgba(0,140,255,.08)' : 'transparent',
                  }}
                >
                  {value === 'all' ? `ALL (${news.length})` : `BREAKING (${news.filter((n: any) => (n.age_minutes ?? 9999) < 120 || n.risk_score >= 8).length})`}
                </button>
              ))}
            </div>

            <div className="max-h-[460px] overflow-y-auto styled-scrollbar divide-y divide-[var(--border-secondary)]">
              {visible.length === 0 ? (
                <div className="px-4 py-6 text-center text-[10px] font-mono text-[var(--text-muted)] tracking-widest">AWAITING INTELLIGENCE...</div>
              ) : visible.slice(0, 30).map((item: any) => {
                const color = riskColor(item.risk_score || 0);
                const sources = Array.isArray(item.sources) && item.sources.length ? item.sources : [item.source].filter(Boolean);
                return (
                  <article
                    key={item.id || item.link}
                    className="px-4 py-3 hover:bg-white/[0.035] transition-colors cursor-pointer border-l-2"
                    style={{ borderLeftColor: color }}
                    onClick={() => item.link && window.open(item.link, '_blank', 'noopener,noreferrer')}
                  >
                    <div className="flex gap-2 items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ color, border: `1px solid ${color}66`, background: `${color}12` }}>
                            {riskLabel(item.risk_score || 0)}
                          </span>
                          {item.coords && (
                            <button
                              onClick={(event) => { event.stopPropagation(); onLocate?.(item.coords[0], item.coords[1]); }}
                              className="text-[var(--text-muted)] hover:text-[#4dc3ff] transition-colors"
                              title={item.location || 'Locate on map'}
                            >
                              <MapPin className="w-3 h-3" />
                            </button>
                          )}
                          <span className="ml-auto text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap">{timeAgo(item.published)}</span>
                        </div>

                        <h4 className="text-[11px] text-[var(--text-primary)] leading-snug font-medium line-clamp-2">{item.title}</h4>
                        <div className="mt-1 text-[8px] font-mono text-white/30 tabular-nums">{absoluteDate(item.published)}</div>

                        <div className="flex flex-wrap gap-1 mt-2">
                          {sources.slice(0, 4).map((source: string) => (
                            <span key={source} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-white/[0.055] text-white/45">{source}</span>
                          ))}
                          {sources.length > 4 && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-white/[0.055] text-white/45">+{sources.length - 4}</span>}
                        </div>

                        {item.machine_assessment && (
                          <div className="mt-2 flex items-start gap-1.5 rounded px-2 py-1.5" style={{ background: 'rgba(0,140,255,.06)', border: '1px solid rgba(0,140,255,.12)' }}>
                            <Zap className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" style={{ color: '#35b5ff' }} />
                            <span className="text-[9px] font-mono leading-relaxed" style={{ color: 'rgba(120,205,255,.75)' }}>{item.machine_assessment}</span>
                          </div>
                        )}
                      </div>
                      <ExternalLink className="w-3 h-3 mt-1 text-white/20 flex-shrink-0" />
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="px-4 py-2 border-t border-white/[0.05] flex items-center justify-between text-[8px] font-mono text-white/30">
              <span>DEDUPLICATED · 2 MIN REFRESH</span>
              <span>{sourceSummary ? `SOURCES ${sourceSummary.healthy}/${sourceSummary.total}` : 'MULTI-SOURCE'}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
