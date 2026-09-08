import crypto from 'node:crypto';
import Parser from 'rss-parser';

const parser = new Parser({ timeout: 7000 });

export interface NewsSourceHealth {
  id: string;
  name: string;
  kind: 'rss' | 'telegram';
  ok: boolean;
  count: number;
  duration_ms: number;
  error?: string;
}

export interface BreakingNewsItem {
  id: string;
  title: string;
  description: string;
  link: string;
  published: string;
  source: string;
  sources: string[];
  source_count: number;
  risk_score: number;
  coords: [number, number] | null;
  coords_default: boolean;
  location?: string;
  age_minutes: number;
  freshness: 'fresh' | 'recent' | 'aging' | 'old';
  machine_assessment: string | null;
}

interface RawArticle {
  title: string;
  description: string;
  link: string;
  published: string;
  source: string;
}

const RSS_SOURCES = [
  { id: 'bbc-world', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'guardian-world', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { id: 'euronews', name: 'Euronews', url: 'https://www.euronews.com/rss?format=xml' },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/rss' },
  { id: 'cbc-world', name: 'CBC', url: 'https://www.cbc.ca/webfeed/rss/rss-world' },
] as const;

const TELEGRAM_CHANNELS = [
  { id: 'osinttechnical', name: 'OSINTtechnical', channel: 'OSINTtechnical' },
  { id: 'faytuks', name: 'Faytuks', channel: 'Faytuks' },
  { id: 'liveuamap', name: 'Liveuamap', channel: 'Liveuamap' },
  { id: 'cyberknow', name: 'CyberKnow', channel: 'CyberKnow' },
] as const;

const RISK_KEYWORDS: Array<[string, number]> = [
  ['nuclear', 4], ['missile', 4], ['ballistic', 4], ['airstrike', 4], ['strike', 3],
  ['invasion', 4], ['explosion', 3], ['bomb', 3], ['drone', 3], ['attack', 3],
  ['military', 2], ['war', 3], ['conflict', 2], ['clash', 2], ['killed', 2],
  ['casualt', 2], ['sanction', 2], ['ceasefire', 2], ['escalat', 2], ['evacuat', 2],
  ['coup', 3], ['hostage', 3], ['mobiliz', 2], ['intercept', 2], ['air defense', 3],
];

/** High-confidence place names only. We prefer no marker to a false marker. */
const GEO_TERMS: Array<[string, string, number, number]> = [
  ['kyiv', 'Kyiv, Ukraine', 50.4501, 30.5234],
  ['kiev', 'Kyiv, Ukraine', 50.4501, 30.5234],
  ['kharkiv', 'Kharkiv, Ukraine', 49.9935, 36.2304],
  ['odesa', 'Odesa, Ukraine', 46.4825, 30.7233],
  ['odessa', 'Odesa, Ukraine', 46.4825, 30.7233],
  ['zaporizhzhia', 'Zaporizhzhia, Ukraine', 47.8388, 35.1396],
  ['dnipro', 'Dnipro, Ukraine', 48.4647, 35.0462],
  ['crimea', 'Crimea, Ukraine', 45.3, 34.0],
  ['ukraine', 'Ukraine', 49.0, 31.0],
  ['moscow', 'Moscow, Russia', 55.7558, 37.6173],
  ['st petersburg', 'St Petersburg, Russia', 59.9311, 30.3609],
  ['russia', 'Russia', 57.5, 50.0],
  ['gaza', 'Gaza', 31.5017, 34.4668],
  ['tel aviv', 'Tel Aviv, Israel', 32.0853, 34.7818],
  ['jerusalem', 'Jerusalem', 31.7683, 35.2137],
  ['israel', 'Israel', 31.4, 34.9],
  ['beirut', 'Beirut, Lebanon', 33.8938, 35.5018],
  ['lebanon', 'Lebanon', 33.8547, 35.8623],
  ['damascus', 'Damascus, Syria', 33.5138, 36.2765],
  ['syria', 'Syria', 34.8, 38.9],
  ['tehran', 'Tehran, Iran', 35.6892, 51.389],
  ['iran', 'Iran', 32.4, 53.7],
  ['sanaa', 'Sanaa, Yemen', 15.3694, 44.191],
  ['yemen', 'Yemen', 15.55, 48.52],
  ['baghdad', 'Baghdad, Iraq', 33.3152, 44.3661],
  ['iraq', 'Iraq', 33.2, 43.7],
  ['taipei', 'Taipei, Taiwan', 25.033, 121.5654],
  ['taiwan', 'Taiwan', 23.7, 120.96],
  ['beijing', 'Beijing, China', 39.9042, 116.4074],
  ['china', 'China', 35.86, 104.2],
  ['pyongyang', 'Pyongyang, North Korea', 39.0392, 125.7625],
  ['north korea', 'North Korea', 40.34, 127.51],
  ['seoul', 'Seoul, South Korea', 37.5665, 126.978],
  ['south korea', 'South Korea', 36.2, 127.9],
  ['tokyo', 'Tokyo, Japan', 35.6762, 139.6503],
  ['washington', 'Washington, DC', 38.9072, -77.0369],
  ['new york', 'New York, US', 40.7128, -74.006],
  ['pentagon', 'Arlington, US', 38.8719, -77.0563],
  ['london', 'London, UK', 51.5072, -0.1276],
  ['paris', 'Paris, France', 48.8566, 2.3522],
  ['berlin', 'Berlin, Germany', 52.52, 13.405],
  ['brussels', 'Brussels, Belgium', 50.8503, 4.3517],
  ['warsaw', 'Warsaw, Poland', 52.2297, 21.0122],
  ['baltic sea', 'Baltic Sea', 57.0, 20.0],
  ['black sea', 'Black Sea', 43.3, 34.0],
  ['red sea', 'Red Sea', 20.0, 38.0],
  ['persian gulf', 'Persian Gulf', 26.5, 52.0],
  ['strait of hormuz', 'Strait of Hormuz', 26.56, 56.25],
  ['south china sea', 'South China Sea', 12.0, 114.0],
];

let cache: { expires: number; value: Promise<{ news: BreakingNewsItem[]; sources: NewsSourceHealth[] }> } | null = null;

function htmlDecode(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function validDate(input?: string | null) {
  const ms = input ? Date.parse(input) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

export function riskScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 1;
  for (const [term, weight] of RISK_KEYWORDS) if (lower.includes(term)) score += weight;
  return Math.min(10, score);
}

export function locateArticle(text: string): { coords: [number, number]; location: string } | null {
  const lower = ` ${text.toLowerCase()} `;
  for (const [term, location, lat, lng] of GEO_TERMS) {
    if (lower.includes(term)) return { coords: [lat, lng], location };
  }
  return null;
}

export function normalizeHeadline(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(live|breaking|update|updates|latest|video|watch)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string) {
  const aa = new Set(normalizeHeadline(a).split(' ').filter(w => w.length > 2));
  const bb = new Set(normalizeHeadline(b).split(' ').filter(w => w.length > 2));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const word of aa) if (bb.has(word)) intersection++;
  return intersection / Math.min(aa.size, bb.size);
}

function freshness(ageMinutes: number): BreakingNewsItem['freshness'] {
  if (ageMinutes < 30) return 'fresh';
  if (ageMinutes < 120) return 'recent';
  if (ageMinutes < 360) return 'aging';
  return 'old';
}

function parseTelegramHTML(html: string, channel: string): RawArticle[] {
  const articles: RawArticle[] = [];
  const blocks = html.match(/<div class="tgme_widget_message_wrap js-widget_message_wrap"[\s\S]*?(?=<div class="tgme_widget_message_wrap js-widget_message_wrap"|$)/gi) || [];
  for (const block of blocks.slice(-12)) {
    const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;
    const description = htmlDecode(textMatch[1]);
    if (description.length < 15) continue;
    const dateMatch = block.match(/<a class="tgme_widget_message_date" href="(https:\/\/t\.me\/[^"]+)"[^>]*>[\s\S]*?<time datetime="([^"]+)"/i);
    articles.push({
      title: description.slice(0, 150),
      description,
      link: dateMatch?.[1] || `https://t.me/${channel}`,
      published: validDate(dateMatch?.[2]),
      source: channel,
    });
  }
  return articles;
}

async function fetchRss(source: typeof RSS_SOURCES[number]): Promise<{ articles: RawArticle[]; health: NewsSourceHealth }> {
  const started = performance.now();
  try {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(6500),
      headers: { 'User-Agent': 'OSIRIS/1.0 (+https://github.com/master7xx/osiris)' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const feed = await parser.parseString(await response.text());
    const articles = (feed.items || []).slice(0, 20).map(item => ({
      title: htmlDecode(item.title || ''),
      description: htmlDecode(item.contentSnippet || item.content || item.summary || ''),
      link: item.link || '',
      published: validDate(item.isoDate || item.pubDate),
      source: source.name,
    })).filter(item => item.title && item.link);
    return { articles, health: { id: source.id, name: source.name, kind: 'rss', ok: true, count: articles.length, duration_ms: Math.round(performance.now() - started) } };
  } catch (error) {
    return { articles: [], health: { id: source.id, name: source.name, kind: 'rss', ok: false, count: 0, duration_ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) } };
  }
}

async function fetchTelegram(source: typeof TELEGRAM_CHANNELS[number]): Promise<{ articles: RawArticle[]; health: NewsSourceHealth }> {
  const started = performance.now();
  try {
    const response = await fetch(`https://t.me/s/${source.channel}`, {
      signal: AbortSignal.timeout(6500),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const articles = parseTelegramHTML(await response.text(), source.name);
    return { articles, health: { id: source.id, name: source.name, kind: 'telegram', ok: true, count: articles.length, duration_ms: Math.round(performance.now() - started) } };
  } catch (error) {
    return { articles: [], health: { id: source.id, name: source.name, kind: 'telegram', ok: false, count: 0, duration_ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) } };
  }
}

export function clusterArticles(raw: RawArticle[], now = Date.now()): BreakingNewsItem[] {
  const cutoff = now - 24 * 60 * 60_000;
  const usable = raw
    .filter(item => Date.parse(item.published) >= cutoff)
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

  const clusters: Array<{ lead: RawArticle; items: RawArticle[] }> = [];
  for (const item of usable) {
    const match = clusters.find(cluster =>
      Math.abs(Date.parse(cluster.lead.published) - Date.parse(item.published)) < 12 * 60 * 60_000 &&
      similarity(cluster.lead.title, item.title) >= 0.62
    );
    if (match) match.items.push(item);
    else clusters.push({ lead: item, items: [item] });
  }

  return clusters.map(cluster => {
    const sorted = [...cluster.items].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    const lead = sorted[0];
    const sources = [...new Set(sorted.map(item => item.source))];
    const combined = `${lead.title} ${lead.description}`;
    const location = locateArticle(combined);
    const score = riskScore(combined);
    const ageMinutes = Math.max(0, Math.floor((now - Date.parse(lead.published)) / 60_000));
    const id = crypto.createHash('sha1').update(`${normalizeHeadline(lead.title)}|${lead.published.slice(0, 13)}`).digest('hex').slice(0, 20);
    return {
      id,
      title: lead.title,
      description: lead.description,
      link: lead.link,
      published: lead.published,
      source: lead.source,
      sources,
      source_count: sources.length,
      risk_score: score,
      coords: location?.coords ?? null,
      coords_default: !location,
      location: location?.location,
      age_minutes: ageMinutes,
      freshness: freshness(ageMinutes),
      machine_assessment: score >= 8 ? `Elevated tactical priority · corroborated by ${sources.length} source${sources.length === 1 ? '' : 's'}.` : null,
    };
  }).sort((a, b) => {
    const corroboration = Math.min(3, b.source_count) - Math.min(3, a.source_count);
    if (corroboration !== 0 && Math.abs(a.age_minutes - b.age_minutes) < 60) return corroboration;
    return Date.parse(b.published) - Date.parse(a.published);
  });
}

async function refresh() {
  const results = await Promise.all([
    ...RSS_SOURCES.map(fetchRss),
    ...TELEGRAM_CHANNELS.map(fetchTelegram),
  ]);
  const raw = results.flatMap(result => result.articles);
  return { news: clusterArticles(raw).slice(0, 100), sources: results.map(result => result.health) };
}

export async function getBreakingNews() {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.value;
  const value = refresh();
  cache = { expires: now + 45_000, value };
  try {
    return await value;
  } catch (error) {
    cache = null;
    throw error;
  }
}
