/**
 * Cosmetic filtering engine (background side).
 *
 * Content scripts ask for the filters of their frame; we answer and inject the
 * stylesheet ourselves with `scripting.insertCSS({ origin: 'USER' })`. User-
 * origin `!important` rules beat author-origin ones, so a page can't override
 * our hiding rules, and since the CSS isn't a <style> element the page can't
 * remove it either.
 */
import {
  buildCss,
  emptyCosmeticBundle,
  hostnameKeys,
  queryCosmetics,
  queryLowlyGeneric,
  type CosmeticBundle,
  type CosmeticQueryResult,
} from '../shared/filters/cosmetic';
import { enabledRulesetIds, type Settings } from '../shared/settings';
import { buildMeta } from './rulesets';
import { psl } from './state';

const bundles = new Map<string, Promise<CosmeticBundle>>();
let custom: CosmeticBundle = emptyCosmeticBundle();
const cache = new Map<string, CosmeticQueryResult>();
const CACHE_SIZE = 256;

function loadBundle(id: string): Promise<CosmeticBundle> {
  let p = bundles.get(id);
  if (!p) {
    p = fetch(chrome.runtime.getURL(`rulesets/${id}.cosmetic.json`))
      .then((r) => r.json() as Promise<CosmeticBundle>)
      .catch(() => emptyCosmeticBundle());
    bundles.set(id, p);
  }
  return p;
}

async function activeBundles(settings: Settings): Promise<CosmeticBundle[]> {
  const meta = await buildMeta();
  const ids = enabledRulesetIds(settings).filter((id) => meta.cosmetic.includes(id));
  const loaded = await Promise.all(ids.map(loadBundle));
  return [...loaded, custom];
}

export function setCustomCosmetics(bundle: CosmeticBundle): void {
  custom = bundle;
  cache.clear();
}

export function invalidateCosmetics(): void {
  cache.clear();
}

export async function queryFrame(settings: Settings, hostname: string): Promise<CosmeticQueryResult> {
  const hit = cache.get(hostname);
  if (hit) return hit;
  const keys = hostnameKeys(hostname, psl.getPublicSuffix(hostname));
  const result = queryCosmetics(await activeBundles(settings), keys);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(hostname, result);
  return result;
}

export async function queryTokens(settings: Settings, hostname: string, tokens: string[]): Promise<string[]> {
  const frame = await queryFrame(settings, hostname);
  if (!frame.generic) return [];
  return queryLowlyGeneric(await activeBundles(settings), tokens, frame.exceptions);
}

export async function injectCss(tabId: number, frameId: number, css: string): Promise<void> {
  if (css === '') return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css, origin: 'USER' });
  } catch {
    /* frame navigated away or is not scriptable */
  }
}

export { buildCss };
