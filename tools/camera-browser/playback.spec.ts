import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const clip = Buffer.from(readFileSync(new URL('./clip.base64', import.meta.url), 'utf8'), 'base64');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
test('overview stays still; selected area plays four clips and releases them on close', async ({ page }) => {
  let downloads = 0;
  await page.route('**/jamcams.tfl.gov.uk/*.mp4*', route => { downloads++; return route.fulfill({ contentType: 'video/mp4', body: clip }); });
  await page.route('**/media/*.jpg', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/cctv/diagnostics?*', route => route.fulfill({ json: { checks: [{ state: 'HTTP_ERROR', httpStatus: 404, checkedAt: '2026-09-25T18:00:00Z' }] } }));
  await page.goto('/tools/camera-browser/');
  await expect(page.getByTestId('overview')).toContainText('SNAPSHOT · LOADED');
  expect(downloads).toBe(0);
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(4);
  await expect(page.getByText('CLIP · PLAYING', { exact: true })).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Camera viewing area' }).getByRole('status').first()).toHaveAttribute('title', /SERVER HTTP 404/);
  await page.screenshot({ path: 'test-results/camera-desktop.png' });
  await page.getByRole('button', { name: 'Switch camera', exact: true }).click();
  await expect(page.locator('h2')).toHaveText('Camera 5');
  await expect(page.locator('video')).toHaveCount(4);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('video')).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('video')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/camera-mobile.png' });
  await page.getByRole('button', { name: 'Close cameras' }).click();
  await expect(page.locator('video')).toHaveCount(0);
});
test('clips refresh; media errors stay visible without inventing HTTP status', async ({ page }) => {
  let refreshed = false;
  await page.route('**/jamcams.tfl.gov.uk/*.mp4*', route => { refreshed ||= route.request().url().includes('_osiris='); return route.fulfill({ contentType: 'video/mp4', body: clip }); });
  await page.route('**/media/*.jpg', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/cctv/diagnostics?*', route => route.fulfill({ json: { checks: [{ state: 'UNKNOWN' }] } }));
  await page.clock.install();
  await page.goto('/tools/camera-browser/');
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(page.getByText('CLIP · PLAYING', { exact: true })).toHaveCount(4);
  await page.clock.fastForward(300001);
  await expect.poll(() => refreshed).toBe(true);
  await page.locator('video').first().evaluate(el => { Object.defineProperty(el, 'error', { value: { code: 2 }, configurable: true }); el.dispatchEvent(new Event('error')); });
  await expect(page.getByText('CLIP · NETWORK', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Camera viewing area' })).not.toContainText('502');
  await expect(page.locator('video')).toHaveCount(4);
});

test('camera stays inside real dashboard workspace with news open, closed and expanded', async ({ page }) => {
  await page.route('**/jamcams.tfl.gov.uk/*.mp4*', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  await page.route('**/media/*.jpg', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/**', route => route.fulfill({ json: { checks: [], events: [], source_health: [], generated_at: new Date().toISOString(), source_count: 0, healthy_sources: 0 } }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/tools/camera-browser/?shell');
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  const camera = page.getByRole('region', { name: 'Camera viewing area' });
  const withinWorkspace = async () => {
    const panel = (await camera.boundingBox())!;
    const workspace = (await page.locator('.dashboard-workspace').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(workspace.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(workspace.x + workspace.width);
    expect(panel.y).toBeGreaterThanOrEqual(workspace.y);
    expect(panel.y + panel.height).toBeLessThanOrEqual(workspace.y + workspace.height);
    const news = await page.locator('#dashboard-news').count() ? await page.locator('#dashboard-news').boundingBox() : null;
    if (news) expect(panel.x + panel.width).toBeLessThanOrEqual(news.x);
    await expect(page.getByRole('button', { name: 'Close cameras' })).toBeInViewport();
  };
  await withinWorkspace();
  await page.screenshot({ path: 'test-results/camera-dashboard-open.png' });
  await page.getByRole('button', { name: 'Close news panel' }).click();
  await expect(page.locator('#dashboard-news')).toHaveCount(0);
  await withinWorkspace();
  await page.getByRole('button', { name: 'Show news panel', exact: true }).click();
  await expect(page.locator('#dashboard-news')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle fullscreen' }).click();
  await withinWorkspace();
  await page.screenshot({ path: 'test-results/camera-dashboard-expanded.png' });
  await page.setViewportSize({ width: 1000, height: 800 });
  await withinWorkspace();
  await page.getByRole('button', { name: 'Toggle fullscreen' }).click();
  await withinWorkspace();
  await page.screenshot({ path: 'test-results/camera-dashboard-narrow.png' });
  await page.getByRole('button', { name: 'Close cameras' }).click();
  await expect(camera).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close side panel', exact: true })).toBeVisible();
});

test('failed snapshots have one compact badge without broken-image text', async ({ page }) => {
  await page.route('**/media/*.jpg', route => route.fulfill({ status: 404 }));
  await page.route('**/api/cctv/diagnostics?*', route => route.fulfill({ json: { checks: [{ state: 'HTTP_ERROR', httpStatus: 404 }] } }));
  await page.goto('/tools/camera-browser/');
  const tile = page.getByTestId('overview');
  await expect(tile.getByRole('status')).toContainText('LOAD FAILED');
  await expect(tile.locator('img')).toHaveAttribute('alt', '');
  await expect(tile.locator('img')).toHaveCSS('opacity', '0');
  await expect(tile.getByRole('status')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/camera-failed-snapshot.png' });
});

test('neighbor selection promotes the camera and preserves expanded mode', async ({ page }) => {
  await page.route('**/jamcams.tfl.gov.uk/*.mp4*', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  await page.route('**/media/*.jpg', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/cctv/diagnostics?*', route => route.fulfill({ json: { checks: [] } }));
  await page.goto('/tools/camera-browser/');
  await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle fullscreen' }).click();
  const area = page.getByRole('region', { name: 'Camera viewing area' });
  for (const id of [1, 2, 3, 2]) {
    await page.getByRole('button', { name: `Show Camera ${id} as main camera`, exact: true }).click();
    await expect(area.locator('h2')).toHaveText(`Camera ${id}`);
    await expect(area).toHaveAttribute('data-expanded', 'true');
    await expect(area.locator('video')).toHaveCount(4);
    await expect(area.locator('video').first()).toHaveAttribute('src', new RegExp(`/${id}\\.mp4`));
    await expect(area.getByRole('button', { name: `Show Camera ${id} as main camera`, exact: true })).toHaveCount(0);
  }
  // Restore the map selection controls and repeat the same camera selection.
  await page.getByRole('button', { name: 'Toggle fullscreen' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Open camera', exact: true }).click();
  await expect(area.locator('h2')).toHaveText('Camera 0');
  await expect(area.locator('video')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/camera-neighbor-selection.png' });
});
