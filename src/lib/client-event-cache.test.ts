import { afterEach, describe, it, expect, vi } from 'vitest';
import { readEventCache, writeEventCache } from './client-event-cache';
import type { EventClientCache } from './client-event-sync';
const cache = (): EventClientCache => ({ version: 1, mode: 'snapshot', savedAt: Date.now(), feed: { events: [], source_health: [], generated_at: new Date().toISOString() } as unknown as EventClientCache['feed'] });
afterEach(() => vi.unstubAllGlobals());
describe('optional browser event cache', () => {
  it('restores a valid checkpoint and ignores damaged storage', () => {
    let stored = '';
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: (_: string, value: string) => { stored = value; } });
    const checkpoint = cache(); writeEventCache(checkpoint); expect(readEventCache()).toEqual(checkpoint);
    stored = '{broken'; expect(readEventCache()).toBeNull();
  });
  it('does not break synchronization when storage is unavailable or full', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } });
    expect(readEventCache()).toBeNull(); expect(() => writeEventCache(cache())).not.toThrow();
  });
  it('discards a cache older than seven days', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...cache(), savedAt: Date.now() - 8 * 86400000 }) });
    expect(readEventCache()).toBeNull();
  });
});
