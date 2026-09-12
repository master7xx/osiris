import type { FusedEvent } from './event-fusion';

export type ConflictZoneSeverity = 'war' | 'high' | 'elevated' | 'moderate';

export interface ConflictZoneDefinition {
  id: string;
  label: string;
  severity: ConflictZoneSeverity;
  lat: number;
  lng: number;
  description: string;
  sourceUrl: string;
  region: string;
  aliases: string[];
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export interface LegacyConflictEvent {
  id: string;
  lat: number;
  lng: number;
  title: string;
  url: string;
  type: string;
  timestamp: string;
  confidence: FusedEvent['confidence'];
  priority_score: number;
  sources: string[];
}

export interface LegacyConflictZone {
  id: string;
  label: string;
  severity: ConflictZoneSeverity;
  lat: number;
  lng: number;
  description: string;
  sourceUrl: string;
  region: string;
  events: LegacyConflictEvent[];
  eventCount: number;
  lastUpdated: string;
}

export const CONFLICT_ZONES: ConflictZoneDefinition[] = [
  {
    id: 'ukraine', label: 'UKRAINE WAR', severity: 'war', lat: 48.5, lng: 31.2, region: 'ukraine',
    description: 'Ongoing Russian invasion of Ukraine — active frontlines across eastern and southern regions.',
    sourceUrl: 'https://liveuamap.com/', aliases: ['ukraine', 'ukrainian', 'украин', 'україн'],
    bounds: { minLat: 44, maxLat: 53, minLng: 22, maxLng: 40 },
  },
  {
    id: 'gaza', label: 'GAZA CONFLICT', severity: 'war', lat: 31.35, lng: 34.35, region: 'gaza',
    description: 'Active military operations and humanitarian crisis in Gaza Strip.',
    sourceUrl: 'https://israelpalestine.liveuamap.com/', aliases: ['gaza', 'rafah', 'газ', 'рафах'],
    bounds: { minLat: 31, maxLat: 32, minLng: 34, maxLng: 34.8 },
  },
  {
    id: 'lebanon', label: 'LEBANON BORDER', severity: 'high', lat: 33.377, lng: 35.483, region: 'lebanon',
    description: 'Active cross-border military operations in southern Lebanon.',
    sourceUrl: 'https://lebanon.liveuamap.com/', aliases: ['lebanon', 'beirut', 'hezbollah', 'ливан', 'бейрут'],
    bounds: { minLat: 33, maxLat: 34.5, minLng: 35, maxLng: 36.5 },
  },
  {
    id: 'sudan', label: 'SUDAN CIVIL WAR', severity: 'war', lat: 15, lng: 30, region: 'sudan',
    description: 'Armed conflict between SAF and RSF factions across Sudan.',
    sourceUrl: 'https://sudan.liveuamap.com/', aliases: ['sudan', 'khartoum', 'rsf', 'судан', 'хартум'],
    bounds: { minLat: 10, maxLat: 22, minLng: 22, maxLng: 38 },
  },
  {
    id: 'myanmar', label: 'MYANMAR CONFLICT', severity: 'war', lat: 19.5, lng: 96.5, region: 'myanmar',
    description: 'Internal conflict between the military junta and opposition forces.',
    sourceUrl: 'https://myanmar.liveuamap.com/', aliases: ['myanmar', 'burma', 'мьянм'],
    bounds: { minLat: 10, maxLat: 28, minLng: 92, maxLng: 101 },
  },
  {
    id: 'yemen', label: 'YEMEN WAR', severity: 'war', lat: 15.5, lng: 48, region: 'yemen',
    description: 'Houthi operations, Red Sea maritime threats, and coalition strikes.',
    sourceUrl: 'https://yemen.liveuamap.com/', aliases: ['yemen', 'houthi', 'sanaa', 'aden', 'йемен', 'хусит', 'сана', 'аден'],
    bounds: { minLat: 12, maxLat: 20, minLng: 42, maxLng: 55 },
  },
  {
    id: 'syria', label: 'SYRIA', severity: 'high', lat: 35, lng: 38.5, region: 'syria',
    description: 'Ongoing conflict and localized insurgencies in Syria.',
    sourceUrl: 'https://syria.liveuamap.com/', aliases: ['syria', 'damascus', 'aleppo', 'сири', 'дамаск', 'алеппо'],
    bounds: { minLat: 32, maxLat: 37, minLng: 35, maxLng: 42 },
  },
  {
    id: 'drc', label: 'DRC EASTERN CONFLICT', severity: 'war', lat: -1, lng: 28.5, region: 'drc',
    description: 'M23 offensive and regional instability in eastern Democratic Republic of the Congo.',
    sourceUrl: 'https://drc.liveuamap.com/', aliases: ['drc', 'congo', 'm23', 'goma', 'конго'],
    bounds: { minLat: -5, maxLat: 5, minLng: 25, maxLng: 32 },
  },
  {
    id: 'red-sea', label: 'RED SEA THREAT', severity: 'high', lat: 16, lng: 40, region: 'red-sea',
    description: 'Missile, drone and maritime security threats in the Red Sea corridor.',
    sourceUrl: 'https://yemen.liveuamap.com/', aliases: ['red sea', 'красное море', 'bab el-mandeb', 'bab al-mandab'],
    bounds: { minLat: 12, maxLat: 22, minLng: 36, maxLng: 44 },
  },
  {
    id: 'taiwan-strait', label: 'TAIWAN STRAIT', severity: 'elevated', lat: 24, lng: 119.5, region: 'taiwan',
    description: 'Military activity and regional tension around the Taiwan Strait.',
    sourceUrl: 'https://china.liveuamap.com/', aliases: ['taiwan strait', 'taiwan', 'тайван'],
    bounds: { minLat: 22, maxLat: 26, minLng: 117, maxLng: 122 },
  },
  {
    id: 'korean-dmz', label: 'KOREAN DMZ', severity: 'elevated', lat: 38.3, lng: 127, region: 'korea',
    description: 'Cross-border tension and military activity around the Korean DMZ.',
    sourceUrl: 'https://liveuamap.com/', aliases: ['north korea', 'south korea', 'korean dmz', 'pyongyang', 'северная корея', 'кндр', 'пхеньян'],
    bounds: { minLat: 37, maxLat: 39.5, minLng: 124, maxLng: 130 },
  },
  {
    id: 'sahel', label: 'SAHEL INSTABILITY', severity: 'high', lat: 14, lng: 5, region: 'sahel',
    description: 'Insurgencies and political instability across the central Sahel.',
    sourceUrl: 'https://africa.liveuamap.com/', aliases: ['sahel', 'mali', 'burkina', 'niger', 'сахел', 'мали', 'нигер'],
    bounds: { minLat: 10, maxLat: 20, minLng: -5, maxLng: 15 },
  },
  {
    id: 'somalia', label: 'SOMALIA', severity: 'high', lat: 5, lng: 46, region: 'somalia',
    description: 'Al-Shabaab insurgency and counter-terrorism operations.',
    sourceUrl: 'https://africa.liveuamap.com/', aliases: ['somalia', 'mogadishu', 'al-shabaab', 'al shabaab', 'сомали', 'могадишо'],
    bounds: { minLat: -2, maxLat: 12, minLng: 40, maxLng: 52 },
  },
  {
    id: 'iraq', label: 'IRAQ INSTABILITY', severity: 'elevated', lat: 33.3, lng: 44.4, region: 'iraq',
    description: 'Militia activity, security incidents and counter-terrorism operations in Iraq.',
    sourceUrl: 'https://iraq.liveuamap.com/', aliases: ['iraq', 'baghdad', 'erbil', 'ирак', 'багдад', 'эрбил'],
    bounds: { minLat: 29, maxLat: 37.5, minLng: 38, maxLng: 49 },
  },
  {
    id: 'ethiopia', label: 'ETHIOPIA', severity: 'elevated', lat: 9, lng: 38.7, region: 'ethiopia',
    description: 'Regional conflict and ethnic tensions across Ethiopia.',
    sourceUrl: 'https://africa.liveuamap.com/', aliases: ['ethiopia', 'tigray', 'amhara', 'эфиоп'],
    bounds: { minLat: 3, maxLat: 15, minLng: 33, maxLng: 48 },
  },
];

const CONFLICT_CATEGORIES = new Set(['conflict', 'protest', 'political']);

function isMappable(event: FusedEvent): event is FusedEvent & { lat: number; lng: number } {
  return typeof event.lat === 'number'
    && typeof event.lng === 'number'
    && Number.isFinite(event.lat)
    && Number.isFinite(event.lng)
    && event.location_confidence >= 0.75;
}

function inside(zone: ConflictZoneDefinition, event: FusedEvent) {
  if (!isMappable(event)) return false;
  return event.lat >= zone.bounds.minLat && event.lat <= zone.bounds.maxLat
    && event.lng >= zone.bounds.minLng && event.lng <= zone.bounds.maxLng;
}

function textualMatch(zone: ConflictZoneDefinition, event: FusedEvent) {
  const haystack = `${event.title} ${event.description} ${event.location || ''}`.toLowerCase();
  return zone.aliases.some(alias => haystack.includes(alias));
}

function legacyEvent(event: FusedEvent): LegacyConflictEvent | null {
  if (!isMappable(event)) return null;
  return {
    id: event.id,
    lat: event.lat,
    lng: event.lng,
    title: event.title,
    url: event.urls[0] || '',
    type: event.category,
    timestamp: event.occurred_at,
    confidence: event.confidence,
    priority_score: event.priority_score,
    sources: [...event.sources],
  };
}

export function projectUnifiedConflicts(
  events: FusedEvent[],
  now = Date.now(),
): { zones: LegacyConflictZone[]; liveEvents: LegacyConflictEvent[] } {
  const conflictEvents = events.filter(event => CONFLICT_CATEGORIES.has(event.category));
  const liveEvents = conflictEvents
    .map(legacyEvent)
    .filter((event): event is LegacyConflictEvent => event !== null)
    .slice(0, 500);

  const zones = CONFLICT_ZONES.map((zone): LegacyConflictZone => {
    const matching = conflictEvents.filter(event => inside(zone, event) || textualMatch(zone, event));
    const mapped = matching
      .map(legacyEvent)
      .filter((event): event is LegacyConflictEvent => event !== null)
      .slice(0, 20);
    const latest = matching.reduce((value, event) => {
      const time = Date.parse(event.last_seen_at || event.occurred_at);
      return Number.isFinite(time) ? Math.max(value, time) : value;
    }, 0);

    return {
      id: zone.id,
      label: zone.label,
      severity: zone.severity,
      lat: zone.lat,
      lng: zone.lng,
      description: zone.description,
      sourceUrl: zone.sourceUrl,
      region: zone.region,
      events: mapped,
      eventCount: matching.length,
      lastUpdated: new Date(latest || now).toISOString(),
    };
  });

  return { zones, liveEvents };
}
