/**
 * Captures the README screenshots (docs/images/) from the built Chrome
 * extension, using the e2e test server for realistic page content.
 * Usage: npm run build:chrome && tsx scripts/screenshots.ts
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../tests/e2e/server';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'dist/chrome');
const OUT = join(ROOT, 'docs/images');
mkdirSync(OUT, { recursive: true });

const server = await startServer();
const profile = mkdtempSync(join(tmpdir(), 'shomer-shots-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    '--host-resolver-rules=MAP * 127.0.0.1',
  ],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const id = new URL(worker.url()).host;
await new Promise((r) => setTimeout(r, 3000));

// Generate some history: learn a tracker on three sites, visit a page with ads.
for (const site of ['site-a.test', 'site-b.test', 'site-c.test']) {
  const p = await context.newPage();
  await p.goto(server.url(site, '/tracker.html'));
  await p.close();
}
for (const scheme of ['light', 'dark'] as const) {
  const page = await context.newPage();
  await page.goto(server.url('news.test', '/ads.html'));
  await page.goto(server.url('fp.test', '/fingerprint.html'));
  await page.evaluate(() => (window as unknown as { fp: { dataUrl(): string } }).fp.dataUrl());
  await page.goto(server.url('news.test', '/ads.html'));
  await new Promise((r) => setTimeout(r, 500));
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, page.url());

  const popup = await context.newPage();
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.setViewportSize({ width: 360, height: 760 });
  await popup.goto(`chrome-extension://${id}/ui/popup.html?tabId=${tabId}`);
  await popup.waitForSelector('.site-name');
  await popup.screenshot({ path: join(OUT, `popup-${scheme}.png`), fullPage: true });
  await popup.close();
  await page.close();

  const dash = await context.newPage();
  await dash.emulateMedia({ colorScheme: scheme });
  await dash.setViewportSize({ width: 1180, height: 760 });
  for (const section of ['overview', 'protection', 'lists', 'trackers']) {
    await dash.goto(`chrome-extension://${id}/ui/dashboard.html#${section}`);
    await dash.waitForSelector('main h1');
    await new Promise((r) => setTimeout(r, 300));
    await dash.screenshot({ path: join(OUT, `dashboard-${section}-${scheme}.png`) });
  }
  await dash.close();
}

const onboarding = await context.newPage();
await onboarding.setViewportSize({ width: 1180, height: 900 });
await onboarding.goto(`chrome-extension://${id}/ui/onboarding.html`);
await onboarding.screenshot({ path: join(OUT, 'onboarding.png') });

await context.close();
await server.close();
rmSync(profile, { recursive: true, force: true });
console.log(`Screenshots written to ${OUT}`);
