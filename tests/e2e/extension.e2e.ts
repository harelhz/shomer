/**
 * End-to-end tests: the built extension (dist/chrome) running in a real
 * Chromium, against the local test server. Run `npm run build:chrome` first.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './server';

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '../../dist/chrome');

let server: TestServer;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let profile: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends a message to the background from an extension page, like the dashboard does. */
async function send(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/ui/dashboard.html`);
  const result = await page.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, ...(p as object) }), [
    type,
    payload,
  ] as const);
  await page.close();
  return result;
}

async function open(host: string, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(server.url(host, path), { waitUntil: 'load' });
  return page;
}

beforeAll(async () => {
  server = await startServer();
  profile = mkdtempSync(join(tmpdir(), 'shomer-e2e-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      '--host-resolver-rules=MAP * 127.0.0.1',
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  // Wait until onInstalled has applied rulesets and registered scripts.
  const deadline = Date.now() + 20_000;
  while ((await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)) < 3) {
    if (Date.now() > deadline) throw new Error('Extension did not finish initialising');
    await sleep(250);
  }
});

afterAll(async () => {
  await context?.close();
  await server?.close();
  rmSync(profile, { recursive: true, force: true });
});

describe('content blocking', () => {
  it('blocks ad and analytics scripts listed in filter lists, but not ordinary scripts', async () => {
    const page = await open('news.test', '/ads.html');
    const ran = await page.evaluate(() => (window as unknown as { __ran?: Record<string, boolean> }).__ran ?? {});
    expect(ran['cdn.test/app.js']).toBe(true);
    expect(ran['pagead2.googlesyndication.com/pagead/js/adsbygoogle.js']).toBeUndefined();
    expect(ran['www.google-analytics.com/analytics.js']).toBeUndefined();
    await page.close();
  });

  it('hides ad elements with cosmetic filters', async () => {
    const page = await open('news.test', '/ads.html');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('ad1')!).display === 'none');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('ad2')!).display === 'none');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('content')!).display)).toBe('block');
    await page.close();
  });

  it('applies "My filters": network, cosmetic and procedural rules', async () => {
    const report = (await send('filters:set', {
      text: [
        '||blocked-by-me.test^',
        'news.test##.custom-ad',
        'news.test##.card:has-text(Sponsored)',
        'this is ##not a valid $$filter',
      ].join('\n'),
    })) as { rules: number; errors: unknown[] };
    expect(report.rules).toBeGreaterThan(0);

    const page = await open('news.test', '/ads.html');
    const ran = await page.evaluate(() => (window as unknown as { __ran?: Record<string, boolean> }).__ran ?? {});
    expect(ran['blocked-by-me.test/thing.js']).toBeUndefined();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('ad3')!).display === 'none');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('sponsored')!).display === 'none');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('organic')!).display)).toBe('block');
    await page.close();
    await send('filters:set', { text: '' });
  });
});

describe('privacy signals', () => {
  it('sends Global Privacy Control and exposes navigator.globalPrivacyControl', async () => {
    const page = await open('site.test', '/index.html');
    const headers = (await page.evaluate(
      async (url) => (await fetch(url)).json(),
      server.url('site.test', '/headers'),
    )) as Record<string, string>;
    expect(headers['sec-gpc']).toBe('1');
    expect(headers.dnt).toBe('1');
    expect(
      await page.evaluate(() => (navigator as unknown as { globalPrivacyControl: boolean }).globalPrivacyControl),
    ).toBe(true);
    await page.close();
  });

  it('strips tracking parameters from URLs', async () => {
    const page = await open('shop.test', '/index.html?id=42&utm_source=newsletter&fbclid=abc');
    const url = new URL(page.url());
    expect(url.searchParams.get('id')).toBe('42');
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.has('fbclid')).toBe(false);
    await page.close();
  });
});

describe('fingerprint shield', () => {
  it('adds noise that is consistent within a page but differs between page loads', async () => {
    const a = await open('fp.test', '/fingerprint.html');
    const first = await a.evaluate(() => (window as unknown as { fp: { dataUrl(): string } }).fp.dataUrl());
    const again = await a.evaluate(() => (window as unknown as { fp: { dataUrl(): string } }).fp.dataUrl());
    expect(again).toBe(first);
    expect(
      await a.evaluate(() => (window as unknown as { fp: { solidPixelsChanged(): number } }).fp.solidPixelsChanged()),
    ).toBeGreaterThan(0);

    const b = await open('fp.test', '/fingerprint.html');
    const other = await b.evaluate(() => (window as unknown as { fp: { dataUrl(): string } }).fp.dataUrl());
    expect(other).not.toBe(first);
    await a.close();
    await b.close();
  });

  it('looks native and cannot be bypassed through a fresh iframe', async () => {
    // The real rendering, from a site where the shield is switched off.
    await send('site:module', { site: 'fp-off.test', module: 'fingerprint', value: false });
    const plain = await open('fp-off.test', '/fingerprint.html');
    const truth = await plain.evaluate(() => (window as unknown as { fp: { dataUrl(): string } }).fp.dataUrl());
    expect(
      await plain.evaluate(() =>
        (window as unknown as { fp: { solidPixelsChanged(): number } }).fp.solidPixelsChanged(),
      ),
    ).toBe(0);
    await plain.close();

    const page = await open('fp.test', '/fingerprint.html');
    const fp = (fn: string) =>
      page.evaluate((f) => (window as unknown as Record<string, Record<string, () => unknown>>).fp![f]!(), fn);
    expect(await fp('toStringLooksNative')).toBe(true);
    expect(await fp('dataUrl')).not.toBe(truth);
    // Pristine prototypes from a brand-new about:blank frame are protected too.
    const viaIframe = await fp('iframeBypass');
    expect(viaIframe).not.toBe(truth);
    // …and agree with the page itself, so the noise can't be spotted by comparing frames.
    expect(viaIframe).toBe(await fp('dataUrl'));
    await page.close();
    await send('site:module', { site: 'fp-off.test', module: 'fingerprint', value: null });
  });
});

describe('browser compatibility of compiled rules', () => {
  it('every regex rule in the generated rulesets is accepted by the browser', async () => {
    const result = await worker.evaluate(async () => {
      const unsupported: string[] = [];
      for (const id of ['url-cleaning', 'shomer-base']) {
        const rules = (await (await fetch(`/rulesets/${id}.json`)).json()) as { condition: { regexFilter?: string } }[];
        for (const r of rules) {
          const regex = r.condition.regexFilter;
          if (regex && !(await chrome.declarativeNetRequest.isRegexSupported({ regex })).isSupported)
            unsupported.push(regex);
        }
      }
      return unsupported;
    });
    expect(result).toEqual([]);
  });
});

describe('cookie banners', () => {
  it('clicks "Reject all" on a OneTrust banner', async () => {
    const page = await open('cmp.test', '/cookie-onetrust.html');
    await page.waitForFunction(() => (window as unknown as { consent?: string }).consent !== undefined, null, {
      timeout: 10_000,
    });
    expect(await page.evaluate(() => (window as unknown as { consent?: string }).consent)).toBe('rejected');
    await page.close();
  });

  it('finds and rejects an unknown Hebrew cookie banner', async () => {
    const page = await open('israeli-site.test', '/cookie-generic.html');
    await page.waitForFunction(() => (window as unknown as { consent?: string }).consent !== undefined, null, {
      timeout: 10_000,
    });
    expect(await page.evaluate(() => (window as unknown as { consent?: string }).consent)).toBe('rejected');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('my-privacy-bar')!).display === 'none');
    await page.close();
  });
});

describe('tracker learning', () => {
  it('blocks a third party after seeing it track on three sites', async () => {
    for (const site of ['site-a.test', 'site-b.test', 'site-c.test']) {
      const page = await open(site, '/tracker.html');
      expect(await page.evaluate(() => (window as unknown as { pixel: Promise<string> }).pixel)).toBe('loaded');
      await page.close();
    }
    const trackers = (await send('trackers:list')) as { domain: string; sites: string[]; learnedAction: string }[];
    const tracker = trackers.find((t) => t.domain === 'tracker.test');
    expect(tracker?.sites.length).toBe(3);
    expect(tracker?.learnedAction).toBe('block');

    await sleep(3000); // learned rules are applied in batches
    const page = await open('site-d.test', '/tracker.html');
    expect(await page.evaluate(() => (window as unknown as { pixel: Promise<string> }).pixel)).toBe('failed');
    await page.close();
  });
});

describe('element picker', () => {
  async function startPicker(page: Page, zapper: boolean) {
    const tabId = (await worker.evaluate(
      async (url) => (await chrome.tabs.query({ url }))[0]?.id,
      page.url(),
    )) as number;
    expect(await send('picker:start', { tabId, zapper })).toEqual({ ok: true });
    await sleep(300);
  }

  it('creates a cosmetic filter for the clicked element', async () => {
    const page = await open('picker.test', '/picker.html');
    await startPicker(page, false);
    await page.mouse.move(100, 100);
    await page.mouse.click(100, 100);
    await sleep(200);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('annoying')!).display === 'none');
    const settings = (await send('settings:get')) as { customFilters: string };
    expect(settings.customFilters).toMatch(/^picker\.test##.+/m);
    await page.close();

    // The filter persists across page loads.
    const again = await open('picker.test', '/picker.html');
    await again.waitForFunction(() => getComputedStyle(document.getElementById('annoying')!).display === 'none');
    expect(await again.evaluate(() => getComputedStyle(document.getElementById('keep')!).display)).toBe('block');
    await again.close();
    await send('filters:set', { text: '' });
  });

  it('zaps elements until the page reloads', async () => {
    const page = await open('picker.test', '/picker.html');
    await startPicker(page, true);
    await page.mouse.click(100, 250);
    await page.waitForFunction(() => document.getElementById('zap-me') === null);
    expect(await page.evaluate(() => document.getElementById('keep') !== null)).toBe(true);
    await page.close();
  });
});

describe('per-site controls', () => {
  it('allowlisting a site turns blocking off there', async () => {
    await send('site:allowlist', { site: 'trusted.test', value: true });
    const page = await open('trusted.test', '/ads.html');
    const ran = await page.evaluate(() => (window as unknown as { __ran?: Record<string, boolean> }).__ran ?? {});
    expect(ran['pagead2.googlesyndication.com/pagead/js/adsbygoogle.js']).toBe(true);
    await page.close();
    await send('site:allowlist', { site: 'trusted.test', value: false });
  });

  it('shows page statistics in the popup', async () => {
    const page = await open('news.test', '/ads.html');
    const tabId = (await worker.evaluate(
      async (url) => (await chrome.tabs.query({ url }))[0]?.id,
      page.url(),
    )) as number;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/ui/popup.html?tabId=${tabId}`);
    await popup.waitForSelector('.site-name');
    expect(await popup.textContent('.site-name')).toBe('news.test');
    expect(await popup.locator('.stat b').first().textContent()).not.toBe('0');
    await popup.close();
    await page.close();
  });
});
