import Parser from 'rss-parser';

export interface NewsSourceHealth {
  id: string;
  name: string;
  kind: 'rss' | 'telegram';
  independent: boolean;
  ok: boolean;
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
  source: string;
  independent: boolean;
}

interface SourceDef {
  id: string;
  name: string;
  kind: 'rss' | 'telegram';
  url?: string;
  channel?: string;
  independent: boolean;
  weight: number;
}

const SOURCES: SourceDef[] = [
  { id: 'bbc-world', name: 'BBC', kind: 'rss', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', independent: false, weight: 0.9 },
  { id: 'guardian-world', name: 'Guardian', kind: 'rss', url: 'https://www.theguardian.com/world/rss', independent: true, weight: 1.0 },
  { id: 'aljazeera', name: 'Al Jazeera', kind: 'rss', url: 'https://www.aljazeera.com/xml/rss/all.xml', independent: false, weight: 0.9 },
  { id: 'euronews-world', name: 'Euronews', kind: 'rss', url: 'https://www.euronews.com/rss?format=mrss&level=theme&name=news', independent: false, weight: 0.85 },

  // Telegram is a fast-signal tier, not a replacement for conventional feeds.
  // These channels are intentionally fetched in parallel with RSS on every run.
  { id: 'kyiv-independent', name: 'Kyiv Independent', kind: 'telegram', channel: 'KyivIndependent_official', independent: true, weight: 1.15 },
  { id: 'citeam', name: 'Conflict Intelligence Team', kind: 'telegram', channel: 'CITeam', independent: true, weight: 1.1 },
  { id: 'wartranslated', name: 'WarTranslated', kind: 'telegram', channel: 'wartranslated', independent: true, weight: 1.0 },
  { id: 'noelreports', name: 'NOELREPORTS', kind: 'telegram', channel: 'noel_reports', independent: true, weight: 0.95 },
  { id: 'faytuks-network', name: 'Faytuks Network', kind: 'telegram', channel: 'Faytuks_Network', independent: true, weight: 0.95 },
  { id: 'liveuamap', name: 'Liveuamap', kind: 'telegram', channel: 'liveuamap', independent: false, weight: 0.9 },
];

const RISK_KEYWORDS = [
  'war', 'missile', 'strike', 'attack', 'crisis', 'military', 'conflict', 'nuclear',
  'invasion', 'bomb', 'drone', 'weapon', 'sanctions', 'ceasefire', 'escalation',
  'killed', 'dead', 'destroyed', 'explosion', 'frontline', 'threat', 'air raid',
  'artillery', 'shelling', 'evacuation', 'intercepted', 'airstrike', 'casualties',
];

interface PlaceDef {
  keys: string[];
  label: string;
  coords: [number, number]; // [lat, lng]
  confidence: number;
}

const PLACES: PlaceDef[] = [
  { keys: ['kyiv', 'kiev'], label: 'Kyiv, Ukraine', coords: [50.4501, 30.5234], confidence: 0.98 },
  { keys: ['kharkiv'], label: 'Kharkiv, Ukraine', coords: [49.9935, 36.2304], confidence: 0.98 },
  { keys: ['odesa', 'odessa'], label: 'Odesa, Ukraine', coords: [46.4825, 30.7233], confidence: 0.98 },
  { keys: ['dnipro'], label: 'Dnipro, Ukraine', coords: [48.4647, 35.0462], confidence: 0.98 },
  { keys: ['zaporizhzhia', 'zaporozhye'], label: 'Zaporizhzhia, Ukraine', coords: [47.8388, 35.1396], confidence: 0.98 },
  { keys: ['lviv'], label: 'Lviv, Ukraine', coords: [49.8397, 24.0297], confidence: 0.98 },
  { keys: ['donetsk'], label: 'Donetsk', coords: [48.0159, 37.8029], confidence: 0.96 },
  { keys: ['crimea', 'sevastopol'], label: 'Crimea', coords: [44.9521, 34.1024], confidence: 0.9 },
  { keys: ['kursk'], label: 'Kursk, Russia', coords: [51.7304, 36.1926], confidence: 0.97 },
  { keys: ['belgorod'], label: 'Belgorod, Russia', coords: [50.5954, 36.5873], confidence: 0.97 },
  { keys: ['moscow'], label: 'Moscow, Russia', coords: [55.7558, 37.6173], confidence: 0.98 },
  { keys: ['st petersburg', 'saint petersburg'], label: 'St Petersburg, Russia', coords: [59.9343, 30.3351], confidence: 0.98 },
  { keys: ['gaza city', 'gaza'], label: 'Gaza', coords: [31.5017, 34.4668], confidence: 0.94 },
  { keys: ['rafah'], label: 'Rafah', coords: [31.2969, 34.2435], confidence: 0.98 },
  { keys: ['tel aviv'], label: 'Tel Aviv, Israel', coords: [32.0853, 34.7818], confidence: 0.98 },
  { keys: ['jerusalem'], label: 'Jerusalem', coords: [31.7683, 35.2137], confidence: 0.98 },
  { keys: ['beirut'], label: 'Beirut, Lebanon', coords: [33.8938, 35.5018], confidence: 0.98 },
  { keys: ['damascus'], label: 'Damascus, Syria', coords: [33.5138, 36.2765], confidence: 0.98 },
  { keys: ['aleppo'], label: 'Aleppo, Syria', coords: [36.2021, 37.1343], confidence: 0.98 },
  { keys: ['tehran'], label: 'Tehran, Iran', coords: [35.6892, 51.3890], confidence: 0.98 },
  { keys: ['isfahan'], label: 'Isfahan, Iran', coords: [32.6546, 51.6680], confidence: 0.98 },
  { keys: ['strait of hormuz', 'hormuz'], label: 'Strait of Hormuz', coords: [26.5667, 56.2500], confidence: 0.92 },
  { keys: ['baghdad'], label: 'Baghdad, Iraq', coords: [33.3152, 44.3661], confidence: 0.98 },
  { keys: ['erbil'], label: 'Erbil, Iraq', coords: [36.1911, 44.0092], confidence: 0.98 },
  { keys: ['sanaa', "sana'a"], label: "Sana'a, Yemen", coords: [15.3694, 44.1910], confidence: 0.98 },
  { keys: ['aden'], label: 'Aden, Yemen', coords: [12.7855, 45.0187], confidence: 0.98 },
  { keys: ['riyadh'], label: 'Riyadh, Saudi Arabia', coords: [24.7136, 46.6753], confidence: 0.98 },
  { keys: ['doha'], label: 'Doha, Qatar', coords: [25.2854, 51.5310], confidence: 0.98 },
  { keys: ['taipei'], label: 'Taipei, Taiwan', coords: [25.0330, 121.5654], confidence: 0.98 },
  { keys: ['beijing'], label: 'Beijing, China', coords: [39.9042, 116.4074], confidence: 0.98 },
  { keys: ['pyongyang'], label: 'Pyongyang, North Korea', coords: [39.0392, 125.7625], confidence: 0.98 },
  { keys: ['seoul'], label: 'Seoul, South Korea', coords: [37.5665, 126.9780], confidence: 0.98 },
  { keys: ['tokyo'], label: 'Tokyo, Japan', coords: [35.6762, 139.6503], confidence: 0.98 },
  { keys: ['washington dc', 'washington, d.c.', 'washington d.c.'], label: 'Washington, DC', coords: [38.9072, -77.0369], confidence: 0.98 },
  { keys: ['new york city', 'new york'], label: 'New York, US', coords: [40.7128, -74.0060], confidence: 0.96 },
  { keys: ['london'], label: 'London, UK', coords: [51.5072, -0.1276], confidence: 0.98 },
  { keys: ['paris'], label: 'Paris, France', coords: [48.8566, 2.3522], confidence: 0.98 },
  { keys: ['berlin'], label: 'Berlin, Germany', coords: [52.5200, 13.4050], confidence: 0.98 },
  { keys: ['brussels'], label: 'Brussels, Belgium', coords: [50.8503, 4.3517], confidence: 0.98 },
  { keys: ['warsaw'], label: 'Warsaw, Poland', coords: [52.2297, 21.0122], confidence: 0.98 },
  { keys: ['bucharest'], label: 'Bucharest, Romania', coords: [44.4268, 26.1025], confidence: 0.98 },
  { keys: ['black sea'], label: 'Black Sea', coords: [43.0, 34.0], confidence: 0.88 },
  { keys: ['red sea'], label: 'Red Sea', coords: [20.0, 38.5], confidence: 0.88 },
];

const parser = new Parser({
  timeout: 6500,
  headers: { 'User-Agent': 'OSIRIS/1.0 (+https://github.com/simplifaisoul/osiris)' },
});

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function validDate(input?: string): string {
  const t = input ? Date.parse(input) : NaN;
  if (!Number.isFinite(t)) return new Date().toISOString();
  return new Date(t).toISOString();
}

function titleFingerprint(title: string): Set<string> {
  const stop = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'as', 'at', 'with', 'from', 'after', 'over']);
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stop.has(word))
      .slice(0, 24),
  );
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
  if (/breaking|urgent|developing|explosion|missile|air raid/i.test(text)) score += 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

export function locateArticle(text: string): { coords: [number, number] | null; location?: string; confidence: number } {
  const lower = text.toLowerCase();
  for (const place of PLACES) {
    if (place.keys.some(key => lower.includes(key))) {
      return { coords: place.coords, location: place.label, confidence: place.confidence };
    }
  }
  return { coords: null, confidence: 0 };
}

function parseTelegram(html: string, source: SourceDef): RawArticle[] {
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

    items.push({ title, description, link, published, source: source.name, independent: source.independent });
  }

  return items.slice(-12);
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

async function fetchSource(source: SourceDef): Promise<{ items: RawArticle[]; health: NewsSourceHealth }> {
  const started = performance.now();
  try {
    let items: RawArticle[] = [];
    if (source.kind === 'rss' && source.url) {
      // rss-parser uses its own HTTP client. Fetch explicitly so every upstream
      // remains visible in OSIRIS server request instrumentation.
      const response = await fetchWithRetry(source.url, {
        signal: AbortSignal.timeout(6500),
        headers: { 'User-Agent': 'OSIRIS/1.0 (+https://github.com/simplifaisoul/osiris)' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const feed = await parser.parseString(xml);
      items = (feed.items || []).slice(0, 15).map(item => ({
        title: decodeHtml(item.title || ''),
        description: decodeHtml(item.contentSnippet || item.content || item.summary || item.title || ''),
        link: item.link || '',
        published: validDate(item.isoDate || item.pubDate),
        source: source.name,
        independent: source.independent,
      })).filter(item => item.title.length >= 8);
    } else if (source.kind === 'telegram' && source.channel) {
      const response = await fetchWithRetry(`https://t.me/s/${source.channel}`, {
        signal: AbortSignal.timeout(6500),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      items = parseTelegram(await response.text(), source);
    }

    return {
      items,
      health: {
        id: source.id,
        name: source.name,
        kind: source.kind,
        independent: source.independent,
        ok: true,
        duration_ms: Math.round(performance.now() - started),
        items: items.length,
      },
    };
  } catch (error) {
    return {
      items: [],
      health: {
        id: source.id,
        name: source.name,
        kind: source.kind,
        independent: source.independent,
        ok: false,
        duration_ms: Math.round(performance.now() - started),
        items: 0,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function clusterArticles(raw: RawArticle[], now = Date.now()): NewsItem[] {
  const maxAge = 24 * 60 * 60_000;
  const candidates = raw
    .map(article => ({ ...article, time: Date.parse(article.published) }))
    .filter(article => Number.isFinite(article.time) && article.time <= now + 5 * 60_000 && now - article.time <= maxAge)
    .sort((a, b) => b.time - a.time);

  const clusters: Array<{ primary: typeof candidates[number]; articles: typeof candidates }> = [];
  for (const article of candidates) {
    const existing = clusters.find(cluster => {
      const dt = Math.abs(cluster.primary.time - article.time);
      return dt <= 6 * 60 * 60_000 && similarity(cluster.primary.title, article.title) >= 0.58;
    });
    if (existing) existing.articles.push(article);
    else clusters.push({ primary: article, articles: [article] });
  }

  return clusters.slice(0, 80).map((cluster, index) => {
    const sorted = [...cluster.articles].sort((a, b) => b.time - a.time);
    const primary = sorted[0];
    const sources = [...new Set(sorted.map(item => item.source))];
    const independentSources = new Set(sorted.filter(item => item.independent).map(item => item.source)).size;
    const text = `${primary.title} ${primary.description}`;
    const location = locateArticle(text);
    const risk = scoreRisk(text);
    const sourceCount = sources.length;
    const confidenceScore = Math.min(1, 0.38 + sourceCount * 0.18 + independentSources * 0.08 + location.confidence * 0.18);
    const confidence: NewsItem['confidence'] = confidenceScore >= 0.78 ? 'high' : confidenceScore >= 0.58 ? 'medium' : 'low';
    const ageMinutes = Math.max(0, Math.round((now - primary.time) / 60_000));

    return {
      id: `${primary.time.toString(36)}-${index}-${titleFingerprint(primary.title).values().next().value || 'news'}`,
      title: primary.title,
      description: primary.description,
      link: primary.link,
      published: new Date(primary.time).toISOString(),
      source: sources[0],
      sources,
      source_count: sourceCount,
      independent_sources: independentSources,
      risk_score: risk,
      confidence,
      coords: location.confidence >= 0.85 ? location.coords : null,
      location: location.location,
      location_confidence: location.confidence,
      age_minutes: ageMinutes,
      machine_assessment: risk >= 8
        ? `High-priority open-source signal${sourceCount > 1 ? ` corroborated by ${sourceCount} sources` : ''}.`
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
    healthy_sources: health.filter(source => source.ok).length,
  };
}

export const __test = { similarity, clusterArticles, scoreRisk };
