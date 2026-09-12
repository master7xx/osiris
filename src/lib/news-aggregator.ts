import { isNewsDigest } from './event-text';
import Parser from 'rss-parser';
import {
  getSourceHealthSnapshot,
  noteSourceFailure,
  noteSourceSuccess,
  shouldProbeSource,
  type SourceRuntimeState,
} from './news-source-health';

export type NewsSourceTier = 'editorial' | 'osint' | 'broadcaster';

export interface NewsSourceHealth {
  id: string;
  name: string;
  kind: 'rss' | 'telegram';
  tier: NewsSourceTier;
  independent: boolean;
  weight: number;
  effective_weight: number;
  state: SourceRuntimeState;
  success_rate: number;
  avg_latency_ms: number;
  consecutive_failures: number;
  empty_streak: number;
  cooldown_until?: string;
  last_error?: string;
  last_success_at?: string;
  last_attempt_at?: string;
  ok: boolean;
  skipped?: boolean;
  duration_ms: number;
  items: number;
  error?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  description: string;
  link: string;
  published: string;
  source: string;
  sources: string[];
  source_count: number;
  independent_sources: number;
  editorial_sources: number;
  evidence_weight: number;
  risk_score: number;
  confidence: 'low' | 'medium' | 'high';
  coords: [number, number] | null;
  location?: string;
  location_confidence: number;
  age_minutes: number;
  machine_assessment: string | null;
}

interface RawArticle {
  title: string;
  description: string;
  link: string;
  published: string;
  sourceId: string;
  source: string;
  sourceTier: NewsSourceTier;
  sourceWeight: number;
  independent: boolean;
}

interface SourceDef {
  id: string;
  name: string;
  kind: 'rss' | 'telegram';
  tier: NewsSourceTier;
  url?: string;
  channel?: string;
  independent: boolean;
  weight: number;
  maxItems: number;
}

const SOURCES: SourceDef[] = [
  { id: 'bbc-world', name: 'BBC', kind: 'rss', tier: 'broadcaster', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', independent: false, weight: 0.95, maxItems: 12 },
  { id: 'guardian-world', name: 'Guardian', kind: 'rss', tier: 'editorial', url: 'https://www.theguardian.com/world/rss', independent: true, weight: 1.05, maxItems: 12 },
  { id: 'aljazeera', name: 'Al Jazeera', kind: 'rss', tier: 'broadcaster', url: 'https://www.aljazeera.com/xml/rss/all.xml', independent: false, weight: 0.95, maxItems: 12 },
  { id: 'euronews-world', name: 'Euronews', kind: 'rss', tier: 'broadcaster', url: 'https://www.euronews.com/rss?format=mrss&level=theme&name=news', independent: false, weight: 0.85, maxItems: 10 },
  { id: 'kyiv-independent', name: 'Kyiv Independent', kind: 'telegram', tier: 'editorial', channel: 'KyivIndependent_official', independent: true, weight: 1.15, maxItems: 8 },
  { id: 'astra', name: 'ASTRA', kind: 'telegram', tier: 'editorial', channel: 'astrapress', independent: true, weight: 1.10, maxItems: 8 },
  { id: 'meduza', name: 'Meduza', kind: 'telegram', tier: 'editorial', channel: 'meduzalive', independent: true, weight: 1.10, maxItems: 8 },
  { id: 'important-stories', name: 'Important Stories', kind: 'telegram', tier: 'editorial', channel: 'istories_media', independent: true, weight: 1.10, maxItems: 8 },
  { id: 'the-insider', name: 'The Insider', kind: 'telegram', tier: 'editorial', channel: 'theinsider', independent: true, weight: 1.10, maxItems: 8 },
  { id: 'novaya-europe', name: 'Novaya Gazeta Europe', kind: 'telegram', tier: 'editorial', channel: 'novaya_europe', independent: true, weight: 1.05, maxItems: 8 },
  { id: 'citeam', name: 'Conflict Intelligence Team', kind: 'telegram', tier: 'osint', channel: 'CITeam', independent: true, weight: 1.05, maxItems: 8 },
  { id: 'wartranslated', name: 'WarTranslated', kind: 'telegram', tier: 'osint', channel: 'wartranslated', independent: true, weight: 0.85, maxItems: 8 },
  { id: 'noelreports', name: 'NOELREPORTS', kind: 'telegram', tier: 'osint', channel: 'noel_reports', independent: true, weight: 0.75, maxItems: 8 },
  { id: 'faytuks-network', name: 'Faytuks Network', kind: 'telegram', tier: 'osint', channel: 'Faytuks_Network', independent: true, weight: 0.75, maxItems: 8 },
  { id: 'liveuamap', name: 'Liveuamap', kind: 'telegram', tier: 'osint', channel: 'liveuamap', independent: false, weight: 0.85, maxItems: 8 },
];

export function newsSourceTransport(name: string): 'rss' | 'telegram' | undefined {
  return SOURCES.find(source => source.name === name)?.kind;
}

const RISK_KEYWORDS = [
  'war', 'missile', 'strike', 'attack', 'crisis', 'military', 'conflict', 'nuclear',
  'invasion', 'bomb', 'drone', 'weapon', 'sanctions', 'ceasefire', 'escalation',
  'killed', 'dead', 'destroyed', 'explosion', 'frontline', 'threat', 'air raid',
  'artillery', 'shelling', 'evacuation', 'intercepted', 'airstrike', 'casualties',
  'война', 'ракет', 'удар', 'атак', 'взрыв', 'беспилот', 'дрон', 'обстрел',
  'погиб', 'ранен', 'эвакуац', 'ядерн', 'наступлен', 'боевые действия',
  'воздушная тревога', 'шахед', 'війна', 'вибух', 'обстріл', 'поранен',
];

interface PlaceDef {
  keys: string[];
  label: string;
  coords: [number, number];
  confidence: number;
}

const PLACES: PlaceDef[] = [
  { keys: ['kyiv', 'kiev', 'киев', 'київ'], label: 'Kyiv, Ukraine', coords: [50.4501, 30.5234], confidence: 0.98 },
  { keys: ['kharkiv', 'харьков', 'харків'], label: 'Kharkiv, Ukraine', coords: [49.9935, 36.2304], confidence: 0.98 },
  { keys: ['odesa', 'odessa', 'одесса', 'одеса'], label: 'Odesa, Ukraine', coords: [46.4825, 30.7233], confidence: 0.98 },
  { keys: ['dnipro', 'днепр', 'дніпро'], label: 'Dnipro, Ukraine', coords: [48.4647, 35.0462], confidence: 0.98 },
  { keys: ['zaporizhzhia', 'zaporozhye', 'запорожье', 'запоріжжя'], label: 'Zaporizhzhia, Ukraine', coords: [47.8388, 35.1396], confidence: 0.98 },
  { keys: ['lviv', 'львов', 'львів'], label: 'Lviv, Ukraine', coords: [49.8397, 24.0297], confidence: 0.98 },
  { keys: ['donetsk', 'донецк', 'донецьк'], label: 'Donetsk', coords: [48.0159, 37.8029], confidence: 0.96 },
  { keys: ['crimea', 'sevastopol', 'крым', 'крим', 'севастополь'], label: 'Crimea', coords: [44.9521, 34.1024], confidence: 0.9 },
  { keys: ['kursk', 'курск'], label: 'Kursk, Russia', coords: [51.7304, 36.1926], confidence: 0.97 },
  { keys: ['belgorod', 'белгород'], label: 'Belgorod, Russia', coords: [50.5954, 36.5873], confidence: 0.97 },
  { keys: ['moscow', 'москва'], label: 'Moscow, Russia', coords: [55.7558, 37.6173], confidence: 0.98 },
  { keys: ['st petersburg', 'saint petersburg', 'санкт-петербург', 'петербург'], label: 'St Petersburg, Russia', coords: [59.9343, 30.3351], confidence: 0.98 },
  { keys: ['gaza city', 'gaza', 'газа'], label: 'Gaza', coords: [31.5017, 34.4668], confidence: 0.94 },
  { keys: ['rafah', 'рафах'], label: 'Rafah', coords: [31.2969, 34.2435], confidence: 0.98 },
  { keys: ['tel aviv', 'тель-авив'], label: 'Tel Aviv, Israel', coords: [32.0853, 34.7818], confidence: 0.98 },
  { keys: ['jerusalem', 'иерусалим'], label: 'Jerusalem', coords: [31.7683, 35.2137], confidence: 0.98 },
  { keys: ['beirut', 'бейрут'], label: 'Beirut, Lebanon', coords: [33.8938, 35.5018], confidence: 0.98 },
  { keys: ['damascus', 'дамаск'], label: 'Damascus, Syria', coords: [33.5138, 36.2765], confidence: 0.98 },
  { keys: ['aleppo', 'алеппо'], label: 'Aleppo, Syria', coords: [36.2021, 37.1343], confidence: 0.98 },
  { keys: ['tehran', 'тегеран'], label: 'Tehran, Iran', coords: [35.6892, 51.3890], confidence: 0.98 },
  { keys: ['isfahan', 'исфахан'], label: 'Isfahan, Iran', coords: [32.6546, 51.6680], confidence: 0.98 },
  { keys: ['strait of hormuz', 'hormuz', 'ормуз'], label: 'Strait of Hormuz', coords: [26.5667, 56.25], confidence: 0.92 },
  { keys: ['baghdad', 'багдад'], label: 'Baghdad, Iraq', coords: [33.3152, 44.3661], confidence: 0.98 },
  { keys: ['erbil', 'эрбиль'], label: 'Erbil, Iraq', coords: [36.1911, 44.0092], confidence: 0.98 },
  { keys: ['sanaa', "sana'a", 'сана'], label: "Sana'a, Yemen", coords: [15.3694, 44.191], confidence: 0.98 },
  { keys: ['aden', 'аден'], label: 'Aden, Yemen', coords: [12.7855, 45.0187], confidence: 0.98 },
  { keys: ['riyadh', 'эр-рияд'], label: 'Riyadh, Saudi Arabia', coords: [24.7136, 46.6753], confidence: 0.98 },
  { keys: ['doha', 'доха'], label: 'Doha, Qatar', coords: [25.2854, 51.531], confidence: 0.98 },
  { keys: ['taipei', 'тайбэй'], label: 'Taipei, Taiwan', coords: [25.033, 121.5654], confidence: 0.98 },
  { keys: ['beijing', 'пекин'], label: 'Beijing, China', coords: [39.9042, 116.4074], confidence: 0.98 },
  { keys: ['pyongyang', 'пхеньян'], label: 'Pyongyang, North Korea', coords: [39.0392, 125.7625], confidence: 0.98 },
  { keys: ['seoul', 'сеул'], label: 'Seoul, South Korea', coords: [37.5665, 126.978], confidence: 0.98 },
  { keys: ['tokyo', 'токио'], label: 'Tokyo, Japan', coords: [35.6762, 139.6503], confidence: 0.98 },
  { keys: ['washington dc', 'washington, d.c.', 'washington d.c.', 'вашингтон'], label: 'Washington, DC', coords: [38.9072, -77.0369], confidence: 0.98 },
  { keys: ['new york city', 'new york', 'нью-йорк'], label: 'New York, US', coords: [40.7128, -74.006], confidence: 0.96 },
  { keys: ['london', 'лондон'], label: 'London, UK', coords: [51.5072, -0.1276], confidence: 0.98 },
  { keys: ['paris', 'париж'], label: 'Paris, France', coords: [48.8566, 2.3522], confidence: 0.98 },
  { keys: ['berlin', 'берлин'], label: 'Berlin, Germany', coords: [52.52, 13.405], confidence: 0.98 },
  { keys: ['brussels', 'брюссель'], label: 'Brussels, Belgium', coords: [50.8503, 4.3517], confidence: 0.98 },
  { keys: ['warsaw', 'варшава'], label: 'Warsaw, Poland', coords: [52.2297, 21.0122], confidence: 0.98 },
  { keys: ['bucharest', 'бухарест'], label: 'Bucharest, Romania', coords: [44.4268, 26.1025], confidence: 0.98 },
  { keys: ['black sea', 'черное море', 'чёрное море'], label: 'Black Sea', coords: [43, 34], confidence: 0.88 },
  { keys: ['red sea', 'красное море'], label: 'Red Sea', coords: [20, 38.5], confidence: 0.88 },
];

const parser = new Parser({ timeout: 6500 });

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validDate(input?: string): string {
  const t = input ? Date.parse(input) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

function titleFingerprint(title: string): Set<string> {
  const stop = new Set([
    'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'as', 'at', 'with', 'from', 'after', 'over',
    'что', 'как', 'это', 'для', 'при', 'после', 'через', 'уже', 'еще', 'ещё', 'его', 'ее', 'её', 'они', 'она',
  ]);
  return new Set(title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(word => word.length > 2 && !stop.has(word)).slice(0, 24));
}

function similarity(a: string, b: string): number {
  const aa = titleFingerprint(a);
  const bb = titleFingerprint(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const word of aa) if (bb.has(word)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

function scoreRisk(text: string): number {
  const lower = text.toLowerCase();
  let score = 1;
  for (const keyword of RISK_KEYWORDS) if (lower.includes(keyword)) score += 1.15;
  if (/breaking|urgent|developing|explosion|missile|air raid|срочно|взрыв|ракет|воздушная тревога/i.test(text)) score += 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

export function locateArticle(text: string): { coords: [number, number] | null; location?: string; confidence: number } {
  const lower = text.toLowerCase();
  for (const place of PLACES) {
    if (place.keys.some(key => lower.includes(key))) return { coords: place.coords, location: place.label, confidence: place.confidence };
  }
  return { coords: null, confidence: 0 };
}

function rawArticle(source: SourceDef, sourceWeight: number, input: Pick<RawArticle, 'title' | 'description' | 'link' | 'published'>): RawArticle {
  return {
    ...input,
    sourceId: source.id,
    source: source.name,
    sourceTier: source.tier,
    sourceWeight,
    independent: source.independent,
  };
}

function parseTelegram(html: string, source: SourceDef, sourceWeight: number): RawArticle[] {
  const blocks = html.split(/(?=<div class="tgme_widget_message_wrap js-widget_message_wrap)/i).slice(1);
  const items: RawArticle[] = [];
  for (const block of blocks) {
    const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;
    const description = decodeHtml(textMatch[1]);
    if (description.length < 20) continue;
    const dateMatch = block.match(/<a class="tgme_widget_message_date" href="([^"]+)"[^>]*>[\s\S]*?<time datetime="([^"]+)"/i);
    const dataPost = block.match(/data-post="([^"]+)"/i)?.[1];
    const link = dateMatch?.[1] || (dataPost ? `https://t.me/${dataPost}` : `https://t.me/${source.channel}`);
    const published = validDate(dateMatch?.[2]);
    const firstSentence = description.split(/\n|(?<=[.!?])\s+/)[0] || description;
    const title = firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}...` : firstSentence;
    items.push(rawArticle(source, sourceWeight, { title, description, link, published }));
  }
  return items.slice(-source.maxItems);
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || response.status < 500 || attempt === attempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('fetch failed');
}

function healthPayload(source: SourceDef, ok: boolean, durationMs: number, items: number, error?: string, skipped = false): NewsSourceHealth {
  const runtime = getSourceHealthSnapshot(source.id, source.weight);
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    tier: source.tier,
    independent: source.independent,
    weight: source.weight,
    ...runtime,
    ok,
    skipped,
    duration_ms: durationMs,
    items,
    error,
  };
}

async function fetchSource(source: SourceDef): Promise<{ items: RawArticle[]; health: NewsSourceHealth }> {
  if (!shouldProbeSource(source.id)) {
    return { items: [], health: healthPayload(source, false, 0, 0, 'adaptive cooldown', true) };
  }

  const started = performance.now();
  try {
    const initialWeight = getSourceHealthSnapshot(source.id, source.weight).effective_weight;
    let items: RawArticle[] = [];

    if (source.kind === 'rss' && source.url) {
      const response = await fetchWithRetry(source.url, {
        signal: AbortSignal.timeout(6500),
        headers: { 'User-Agent': 'OSIRIS/1.0 (+https://github.com/master7xx/osiris)' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await parser.parseString(await response.text());
      items = (feed.items || []).slice(0, source.maxItems).map(item => rawArticle(source, initialWeight, {
        title: decodeHtml(item.title || ''),
        description: decodeHtml(item.contentSnippet || item.content || item.summary || item.title || ''),
        link: item.link || '',
        published: validDate(item.isoDate || item.pubDate),
      })).filter(item => item.title.length >= 8);
    } else if (source.kind === 'telegram' && source.channel) {
      const response = await fetchWithRetry(`https://t.me/s/${source.channel}`, {
        signal: AbortSignal.timeout(6500),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      items = parseTelegram(await response.text(), source, initialWeight);
    }

    const durationMs = Math.round(performance.now() - started);
    noteSourceSuccess(source.id, durationMs, items.length);
    const recoveredWeight = getSourceHealthSnapshot(source.id, source.weight).effective_weight;
    items = items.map(item => ({ ...item, sourceWeight: recoveredWeight }));
    return { items, health: healthPayload(source, true, durationMs, items.length) };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : String(error);
    noteSourceFailure(source.id, message, durationMs);
    return { items: [], health: healthPayload(source, false, durationMs, 0, message) };
  }
}

function confidenceFor(articles: RawArticle[], locationConfidence: number) {
  const bySource = new Map<string, RawArticle>();
  for (const article of articles) {
    const previous = bySource.get(article.sourceId);
    if (!previous || article.sourceWeight > previous.sourceWeight) bySource.set(article.sourceId, article);
  }
  const evidence = [...bySource.values()];
  const sourceCount = evidence.length;
  const independentSources = evidence.filter(item => item.independent).length;
  const editorialSources = evidence.filter(item => item.sourceTier === 'editorial').length;
  const evidenceWeight = evidence.reduce((sum, item) => sum + item.sourceWeight, 0);
  const corroboration = Math.max(0, sourceCount - 1);
  const score = Math.min(1,
    0.26
    + Math.min(0.34, evidenceWeight * 0.15)
    + Math.min(0.12, independentSources * 0.05)
    + Math.min(0.12, editorialSources * 0.04)
    + Math.min(0.08, corroboration * 0.04)
    + locationConfidence * 0.08,
  );
  return { score, sourceCount, independentSources, editorialSources, evidenceWeight };
}

function clusterArticles(raw: RawArticle[], now = Date.now()): NewsItem[] {
  const maxAge = 24 * 60 * 60_000;
  const candidates = raw.map(article => ({ ...article, time: Date.parse(article.published) }))
    .filter(article => Number.isFinite(article.time) && article.time <= now + 5 * 60_000 && now - article.time <= maxAge)
    .sort((a, b) => b.time - a.time);

  const clusters: Array<{ primary: typeof candidates[number]; articles: typeof candidates }> = [];
  for (const article of candidates) {
    const existing = clusters.find(cluster => Math.abs(cluster.primary.time - article.time) <= 6 * 60 * 60_000
      && isNewsDigest(cluster.primary.title, cluster.primary.description) === isNewsDigest(article.title, article.description)
      && similarity(cluster.primary.title, article.title) >= 0.58);
    if (existing) existing.articles.push(article);
    else clusters.push({ primary: article, articles: [article] });
  }

  return clusters.slice(0, 80).map((cluster, index) => {
    const primary = [...cluster.articles].sort((a, b) => b.sourceWeight - a.sourceWeight || b.time - a.time)[0];
    const evidenceBySource = new Map<string, typeof primary>();
    for (const article of cluster.articles) {
      const previous = evidenceBySource.get(article.sourceId);
      if (!previous || article.sourceWeight > previous.sourceWeight || (article.sourceWeight === previous.sourceWeight && article.time > previous.time)) {
        evidenceBySource.set(article.sourceId, article);
      }
    }
    const evidence = [...evidenceBySource.values()].sort((a, b) => b.sourceWeight - a.sourceWeight || b.time - a.time);
    const sources = evidence.map(item => item.source);
    const text = `${primary.title} ${primary.description}`;
    const location = locateArticle(text);
    const risk = scoreRisk(text);
    const confidenceData = confidenceFor(cluster.articles, location.confidence);
    const confidence: NewsItem['confidence'] = confidenceData.score >= 0.78 ? 'high' : confidenceData.score >= 0.56 ? 'medium' : 'low';
    const ageMinutes = Math.max(0, Math.round((now - primary.time) / 60_000));
    return {
      id: `${primary.time.toString(36)}-${index}-${titleFingerprint(primary.title).values().next().value || 'news'}`,
      title: primary.title,
      description: primary.description,
      link: primary.link,
      published: new Date(primary.time).toISOString(),
      source: primary.source,
      sources,
      source_count: confidenceData.sourceCount,
      independent_sources: confidenceData.independentSources,
      editorial_sources: confidenceData.editorialSources,
      evidence_weight: Number(confidenceData.evidenceWeight.toFixed(2)),
      risk_score: risk,
      confidence,
      coords: location.confidence >= 0.85 ? location.coords : null,
      location: location.location,
      location_confidence: location.confidence,
      age_minutes: ageMinutes,
      machine_assessment: risk >= 8
        ? `High-priority open-source signal${confidenceData.sourceCount > 1 ? ` corroborated by ${confidenceData.sourceCount} sources` : ''}.`
        : null,
    };
  });
}

export async function aggregateNews() {
  const results = await Promise.all(SOURCES.map(fetchSource));
  const raw = results.flatMap(result => result.items);
  const news = clusterArticles(raw);
  const health = results.map(result => result.health);
  return {
    news,
    health,
    source_count: SOURCES.length,
    healthy_sources: health.filter(source => source.state === 'healthy').length,
    degraded_sources: health.filter(source => source.state === 'degraded').length,
    cooldown_sources: health.filter(source => source.state === 'cooldown').length,
    independent_sources: SOURCES.filter(source => source.independent).length,
    editorial_sources: SOURCES.filter(source => source.tier === 'editorial').length,
  };
}

export const __test = {
  similarity,
  clusterArticles,
  scoreRisk,
  confidenceFor,
  sources: SOURCES.map(({ id, name, kind, tier, channel, independent, weight, maxItems }) => ({ id, name, kind, tier, channel, independent, weight, maxItems })),
};
