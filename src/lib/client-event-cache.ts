import { validateClientCache, type EventClientCache } from './client-event-sync';
const KEY = 'osiris.world-events.cache.v1';
const MAX_CHARS = 2 * 1024 * 1024;
export function readEventCache(): EventClientCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > MAX_CHARS) return null;
    const cache = validateClientCache(JSON.parse(raw));
    if (!cache || Date.now() - cache.savedAt > 7 * 86400000 || cache.savedAt > Date.now() + 60000) return null;
    return cache;
  } catch { return null; }
}
export function writeEventCache(cache: EventClientCache) {
  try {
    const raw = JSON.stringify(cache);
    if (raw.length <= MAX_CHARS) localStorage.setItem(KEY, raw);
    else localStorage.removeItem(KEY);
  } catch { /* Storage quota/private mode must not interrupt live synchronization. */ }
}
