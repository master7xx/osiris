import { Activity, CircleAlert, Info, Landmark, Newspaper, Radio, Send, TriangleAlert, Globe, Radar } from 'lucide-react';
import type { EventEvidence } from '@/lib/event-fusion';

export function SeverityBadge({ severity }: { severity: number }) {
  const level = severity >= 70 ? 'high' : severity >= 35 ? 'medium' : 'low';
  const Icon = level === 'high' ? TriangleAlert : level === 'medium' ? CircleAlert : Info;
  return <span className="world-event-severity" data-level={level} title={`Severity: ${level} (${severity}/100)`}><Icon aria-hidden="true" /><span>{level} · {severity}</span></span>;
}

export function SourceBadge({ source, evidence }: { source: string; evidence?: EventEvidence }) {
  let telegram = evidence?.transport === 'telegram';
  if (!telegram && evidence?.url) {
    try { telegram = ['t.me', 'telegram.me', 'telegram.org'].includes(new URL(evidence.url).hostname.toLowerCase()); } catch { /* Unknown transport keeps the source-kind icon. */ }
  }
  const bbc = /^bbc(?:\s|$)/i.test(source);
  const kind = evidence?.kind;
  const Icon = telegram ? Send : kind === 'sensor' ? Activity : kind === 'official' ? Landmark : kind === 'broadcaster' ? Radio : kind === 'osint' ? Radar : kind === 'aggregator' ? Globe : Newspaper;
  const label = telegram ? 'Telegram' : bbc ? 'BBC' : kind || 'Source';
  return <span className="world-event-source" data-transport={telegram ? 'telegram' : 'other'} title={`${label}: ${source}`}>
    {bbc && !telegram ? <span className="world-event-bbc" aria-hidden="true">BBC</span> : <Icon aria-hidden="true" />}
    <span>{telegram ? `Telegram · ${source}` : source}</span>
  </span>;
}
