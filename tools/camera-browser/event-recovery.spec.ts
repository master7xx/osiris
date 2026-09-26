import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
const cacheKey = 'osiris.world-events.cache.v1';
test('rejects damaged cache, retains a coherent checkpoint on outage and recovers after cursor reset', async ({ page }) => {
  const time = new Date().toISOString();
  const event = { id: 'a', title: 'Initial event', description: '', category: 'conflict', categories: ['conflict'], occurred_at: time,
    first_seen_at: time, last_seen_at: time, location_confidence: 0, severity: 60, priority_score: 60,
    confidence: 'unconfirmed', status: 'active', evidence: [], sources: [], source_count: 0,
    independent_sources: 0, evidence_weight: 0, urls: [], tags: [], age_minutes: 0 };
  const collector = { last_success_at: time, source_health: [] };
  // Structurally readable cache, but missing change_sequence: old validation accepted it.
  const broken = { version: 1, mode: 'durable', savedAt: Date.now(), cursor: 'broken',
    feed: { events: [{ ...event, title: 'Damaged cache event', fused_id: 'a', lifecycle: 'ongoing',
      first_observed_at: time, last_observed_at: time, changed_at: time, update_count: 0 }], source_health: [], generated_at: time } };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: cacheKey, value: broken });
  let phase = 'initial';
  let bootstrapCount = 0;
  const cursors: string[] = [];
  await page.route('**/api/events/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/sync')) return route.fulfill({ json: { version: 1, mode: 'durable' } });
    if (url.pathname.endsWith('/stored')) {
      bootstrapCount++;
      return route.fulfill({ json: { events: [{ id: 'a', revision: '1', cursor: '1', payload: { ...event, title: phase === 'reset' ? 'Reset event' : event.title },
        first_observed_at: time, last_observed_at: time, changed_at: time }], collector, cursor: phase === 'reset' ? 'reset' : 'start' } });
    }
    cursors.push(url.searchParams.get('cursor') || '');
    if (phase === 'outage') return route.fulfill({ status: 503, json: {} });
    if (phase === 'reset') return route.fulfill({ status: 410, json: { reset_required: true } });
    return route.fulfill({ json: { changes: [{ event_id: 'a', revision: '2', cursor: '2', payload: { ...event, title: 'Recovered event' }, committed_at: time }],
      collector, cursor: 'recovered', has_more: false } });
  });
  const checkpoint = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), cacheKey);
  await page.goto('/tools/camera-browser/?events');
  await expect(page.getByTestId('sync-state')).toHaveText('ready');
  await expect(page.getByRole('listitem')).toHaveText('Initial event');
  expect(bootstrapCount).toBe(1);
  expect(cursors).toEqual([]);
  const before = await checkpoint();
  phase = 'outage';
  await page.getByRole('button', { name: 'Refresh events' }).click();
  await expect(page.getByTestId('sync-state')).toHaveText('error');
  await expect(page.getByTestId('cache-state')).toHaveText('cached');
  await expect(page.getByRole('listitem')).toHaveText('Initial event');
  expect(await checkpoint()).toEqual(before);
  await page.keyboard.press('Control+Shift+d');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT', exact: true }).click();
  const file = await downloaded;
  const report = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(report.reportVersion).toBe(2);
  expect(report.eventIngest).toMatchObject({ mode: 'durable', cached: true, refreshError: 'HTTP 503',
    feedGeneratedAt: time, counts: { total: 1 }, freshness: { stale: true } });
  expect(report.eventIngest.checkpointSavedAt).toBe(new Date(before.savedAt).toISOString());
  expect(report.eventIngest.events).toBeUndefined();
  await page.keyboard.press('Control+Shift+d');
  phase = 'recovery';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('listitem')).toHaveText('Recovered event');
  await expect(page.getByTestId('cache-state')).toHaveText('fresh');
  await expect(page.getByTestId('sync-error')).toBeEmpty();
  expect(cursors).toEqual(['start', 'start']);
  expect((await checkpoint()).cursor).toBe('recovered');
  phase = 'reset';
  await page.getByRole('button', { name: 'Refresh events' }).click();
  await expect(page.getByRole('listitem')).toHaveText('Reset event');
  expect(bootstrapCount).toBe(2);
  expect((await checkpoint()).cursor).toBe('reset');
});
