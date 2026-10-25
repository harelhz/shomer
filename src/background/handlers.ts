/**
 * Message handlers. Content-script messages are treated as untrusted input
 * (a compromised renderer can send anything a content script can), so only
 * extension pages may change settings — see PRIVILEGED_MESSAGES.
 */
import { MODULE_IDS, RULESETS } from '../shared/constants';
import { cookieBannerCss } from '../data/cookie-banners';
import { isSafeSelector } from '../shared/filters/parser';
import {
  PRIVILEGED_MESSAGES,
  type BackupData,
  type ContentInitResponse,
  type MessageMap,
  type MessageType,
  type PopupData,
  type Request,
  type Response,
  type ThirdPartyInfo,
} from '../shared/messages';
import { enabledRulesetIds, isModuleActive, isValidDomain, sanitizeSettings, type Settings } from '../shared/settings';
import { hostnameOf, isWebUrl } from '../shared/util';
import { applyAll, compileCustomFilters, dynamicRuleCount } from './apply';
import { buildCss, injectCss, queryFrame, queryTokens } from './cosmetics';
import { effectiveAction, noteTracking } from './learning';
import { buildMeta } from './rulesets';
import { psl, ready, saveSettings, saveStatsSoon, state } from './state';
import { getTab, recordCookie, recordFingerprint, restoreTabs } from './tabs';
import { learnedAction, sanitizeTrackerDb } from './tracker-logic';

type Sender = chrome.runtime.MessageSender;
type Handler<K extends MessageType> = (msg: Request<K>, sender: Sender) => Promise<Response<K>> | Response<K>;

/** Fingerprinting APIs strong enough to count as a tracking signal. */
const STRONG_FP_APIS = new Set(['canvas-text', 'webgl-renderer', 'audio', 'font-metrics']);

const INACTIVE: ContentInitResponse = { active: false, cosmetic: false, generic: false, procedural: [], cookies: null };

function frameContext(sender: Sender): { tabId: number; frameId: number; host: string; site: string } | null {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return null;
  const host = hostnameOf(sender.url) || hostnameOf(sender.origin) || hostnameOf(sender.tab?.url);
  const topHost = hostnameOf(sender.tab?.url) || host;
  if (!host) return null;
  return { tabId, frameId: sender.frameId ?? 0, host, site: psl.getDomain(topHost) };
}

async function updateSettings(mutate: (s: Settings) => void): Promise<Settings> {
  const next = structuredClone(state.settings);
  mutate(next);
  const saved = await saveSettings(next);
  await applyAll();
  return saved;
}

async function popupData(tabId: number): Promise<PopupData | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;
  const url = tab.url ?? tab.pendingUrl ?? '';
  const hostname = hostnameOf(url);
  const site = hostname ? psl.getDomain(hostname) : '';
  const tabState = getTab(tabId);
  const sameDocument = tabState && tabState.hostname === hostname;
  const { settings } = state;

  const modules = Object.fromEntries(
    MODULE_IDS.map((m) => [m, { global: settings.modules[m], site: settings.siteModules[site]?.[m] !== false }]),
  ) as PopupData['modules'];

  const thirdParties: ThirdPartyInfo[] = Object.entries(sameDocument ? tabState.domains : {})
    .map(([domain, d]) => {
      const { action, source } = effectiveAction(domain);
      const listBlocked = action === 'none' && d.blocked > 0;
      return {
        domain,
        requests: d.requests,
        blocked: d.blocked,
        tracking: d.tracking || action === 'block' || action === 'cookieblock',
        sites: state.trackers[domain]?.sites.length ?? 0,
        action: listBlocked ? 'block' : action,
        source: listBlocked ? 'list' : source,
      } satisfies ThirdPartyInfo;
    })
    .sort((a, b) => Number(b.tracking) - Number(a.tracking) || b.blocked - a.blocked || b.requests - a.requests);

  let blocked = sameDocument ? tabState.blocked : 0;
  if (blocked === 0 && sameDocument) {
    // Some browsers don't report DNR blocks through webRequest; ask DNR.
    try {
      const matched = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
      blocked = matched.rulesMatchedInfo.length;
    } catch {
      /* quota or unsupported */
    }
  }

  return {
    tabId,
    url,
    hostname,
    site,
    supported: isWebUrl(url),
    allowlisted: settings.allowlist.includes(site),
    threshold: settings.learningThreshold,
    modules,
    stats: {
      blocked,
      fingerprint: sameDocument ? Object.values(tabState.fingerprint).reduce((a, b) => a + b, 0) : 0,
      cookie: sameDocument ? tabState.cookie : null,
    },
    fingerprintApis: sameDocument ? Object.keys(tabState.fingerprint) : [],
    thirdParties,
  };
}

const handlers: { [K in MessageType]: Handler<K> } = {
  async 'content:init'(_msg, sender) {
    const ctx = frameContext(sender);
    if (!ctx) return INACTIVE;
    const { settings } = state;
    if (settings.allowlist.includes(ctx.site)) return INACTIVE;
    const cosmetic = isModuleActive(settings, ctx.site, 'adblock');
    const cookies = isModuleActive(settings, ctx.site, 'cookies');
    let css = '';
    let procedural: string[] = [];
    let generic = false;
    if (cosmetic) {
      const result = await queryFrame(settings, ctx.host);
      css = buildCss(result.selectors);
      procedural = result.procedural;
      generic = result.generic;
    }
    if (cookies) css += `\n${cookieBannerCss(settings.cookieMode)}`;
    void injectCss(ctx.tabId, ctx.frameId, css);
    return { active: true, cosmetic, generic, procedural, cookies: cookies ? { mode: settings.cookieMode } : null };
  },

  async 'content:tokens'(msg, sender) {
    const ctx = frameContext(sender);
    if (!ctx || !Array.isArray(msg.tokens) || !isModuleActive(state.settings, ctx.site, 'adblock')) return;
    const tokens = msg.tokens.filter((t) => typeof t === 'string' && t.length < 256).slice(0, 5000);
    const selectors = await queryTokens(state.settings, ctx.host, tokens);
    await injectCss(ctx.tabId, ctx.frameId, buildCss(selectors));
  },

  'content:fp'(msg, sender) {
    const ctx = frameContext(sender);
    if (!ctx || typeof msg.api !== 'string') return;
    recordFingerprint(ctx.tabId, msg.api.slice(0, 32));
    state.stats.fingerprint++;
    saveStatsSoon();
    // Fingerprinting by a third-party script is a tracking signal — but only
    // trust the report if that script's domain really loaded in this tab.
    const scriptHost = hostnameOf(msg.script);
    if (!scriptHost || !STRONG_FP_APIS.has(msg.api)) return;
    const base = psl.getDomain(scriptHost);
    if (base !== ctx.site && getTab(ctx.tabId)?.domains[base]) noteTracking(ctx.tabId, base, ctx.site, 'fingerprint');
  },

  'content:cookie'(msg, sender) {
    const ctx = frameContext(sender);
    if (!ctx || typeof msg.cmp !== 'string') return;
    recordCookie(ctx.tabId, msg.cmp.slice(0, 64), msg.action === 'rejected' ? 'rejected' : 'hidden');
    state.stats.cookies++;
    saveStatsSoon();
  },

  async 'picker:create'(msg, sender) {
    const ctx = frameContext(sender);
    const selector = typeof msg.selector === 'string' ? msg.selector.trim() : '';
    // A content script may only add a cosmetic filter for its own hostname.
    if (!ctx || selector === '' || selector.length > 1000 || !isSafeSelector(selector) || selector.includes('\n')) {
      return { ok: false };
    }
    const filter = `${ctx.host}##${selector}`;
    await updateSettings((s) => {
      s.customFilters = `${s.customFilters.trimEnd()}\n${filter}\n`.trimStart();
    });
    await injectCss(ctx.tabId, ctx.frameId, buildCss([selector]));
    return { ok: true, filter };
  },

  async 'picker:start'(msg) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: msg.tabId },
        func: (zapper: boolean) => {
          (window as unknown as { __shomerPickerMode: string }).__shomerPickerMode = zapper ? 'zapper' : 'picker';
        },
        args: [msg.zapper],
      });
      await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['content/picker.js'] });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  'popup:get': (msg) => popupData(msg.tabId),

  'settings:get': () => state.settings,

  'settings:update': (msg) =>
    updateSettings((s) => {
      const patched = sanitizeSettings({ ...s, ...msg.patch });
      Object.assign(s, patched);
    }),

  'site:allowlist': (msg) =>
    updateSettings((s) => {
      if (!isValidDomain(msg.site)) return;
      const set = new Set(s.allowlist);
      if (msg.value) set.add(msg.site);
      else set.delete(msg.site);
      s.allowlist = [...set];
    }),

  'site:module': (msg) =>
    updateSettings((s) => {
      if (!isValidDomain(msg.site) || !MODULE_IDS.includes(msg.module)) return;
      const overrides = { ...s.siteModules[msg.site] };
      if (msg.value === null || msg.value === true) delete overrides[msg.module];
      else overrides[msg.module] = false;
      if (Object.keys(overrides).length > 0) s.siteModules[msg.site] = overrides;
      else delete s.siteModules[msg.site];
    }),

  'tracker:set': (msg) =>
    updateSettings((s) => {
      if (!isValidDomain(msg.domain)) return;
      if (msg.action === null) delete s.trackerOverrides[msg.domain];
      else s.trackerOverrides[msg.domain] = msg.action;
    }),

  'trackers:list': () => {
    const { trackers, settings } = state;
    return Object.entries(trackers)
      .map(([domain, r]) => ({
        domain,
        sites: r.sites,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        signals: r.signals as Record<string, number>,
        learnedAction: learnedAction(domain, r, settings.learningThreshold),
        override: settings.trackerOverrides[domain] ?? null,
      }))
      .sort((a, b) => b.sites.length - a.sites.length || a.domain.localeCompare(b.domain));
  },

  async 'trackers:reset'() {
    state.trackers = {};
    await chrome.storage.local.set({ trackers: {} });
    await applyAll();
  },

  async 'filters:set'(msg) {
    const text = String(msg.text ?? '');
    const compiled = compileCustomFilters(text);
    await updateSettings((s) => {
      s.customFilters = text;
    });
    return {
      ok: compiled.unsupportedLines.length === 0,
      rules: compiled.rules.length,
      cosmetic: compiled.stats.cosmetic,
      errors: compiled.unsupportedLines.slice(0, 200),
    };
  },

  async 'overview:get'() {
    const meta = await buildMeta();
    const enabled = new Set(enabledRulesetIds(state.settings));
    let available: number | null = null;
    try {
      available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
    } catch {
      /* unsupported */
    }
    const learned = Object.entries(state.trackers);
    return {
      version: chrome.runtime.getManifest().version,
      builtAt: meta.builtAt,
      stats: state.stats,
      rulesets: RULESETS.map((r) => {
        const m = meta.lists[r.id];
        return {
          ...r,
          enabled: state.settings.rulesets[r.id] ?? false,
          active: enabled.has(r.id),
          network: m?.network ?? 0,
          rules: m?.rules ?? 0,
          cosmetic: m?.cosmetic ?? 0,
          scriptlets: m?.scriptlets ?? 0,
          unsupported: m?.unsupported ?? 0,
        };
      }),
      dynamicRules: dynamicRuleCount,
      availableStaticRules: available,
      learnedTrackers: learned.length,
      blockedTrackers: learned.filter(([d, r]) => learnedAction(d, r, state.settings.learningThreshold) !== 'none')
        .length,
      lastError: state.lastError,
    };
  },

  'backup:export': () =>
    ({
      app: 'shomer',
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      trackers: state.trackers,
    }) satisfies BackupData,

  async 'backup:import'(msg) {
    const data = msg.data as Partial<BackupData> | null;
    if (!data || data.app !== 'shomer' || typeof data.settings !== 'object') {
      return { ok: false, error: 'This file is not a Shomer backup.' };
    }
    await saveSettings(sanitizeSettings(data.settings));
    if (data.trackers) {
      state.trackers = sanitizeTrackerDb(data.trackers);
      await chrome.storage.local.set({ trackers: state.trackers });
    }
    await applyAll();
    return { ok: true };
  },
};

function isExtensionPage(sender: Sender): boolean {
  return sender.id === chrome.runtime.id && (sender.url ?? '').startsWith(chrome.runtime.getURL(''));
}

export async function handleMessage(message: unknown, sender: Sender): Promise<unknown> {
  if (!message || typeof message !== 'object') throw new Error('Invalid message');
  const type = (message as { type?: unknown }).type as MessageType;
  const handler = handlers[type] as Handler<MessageType> | undefined;
  if (!handler) throw new Error(`Unknown message type: ${String(type)}`);
  if (sender.id !== chrome.runtime.id) throw new Error('Forbidden');
  if (PRIVILEGED_MESSAGES.has(type) && !isExtensionPage(sender)) throw new Error('Forbidden');
  await Promise.all([ready(), restoreTabs()]);
  return handler(message as Request<MessageType>, sender);
}

export type { MessageMap };
