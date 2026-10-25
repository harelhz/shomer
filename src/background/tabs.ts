/**
 * Per-tab statistics shown in the popup: what was blocked, which third
 * parties were contacted, what fingerprinting was attempted.
 *
 * Mirrored to chrome.storage.session so the popup still works after the
 * service worker has been restarted mid-page.
 */
import { debounce } from '../shared/util';

export interface DomainStats {
  requests: number;
  blocked: number;
  tracking: boolean;
}

export interface TabState {
  url: string;
  hostname: string;
  site: string;
  blocked: number;
  domains: Record<string, DomainStats>;
  fingerprint: Record<string, number>;
  cookie: { cmp: string; action: string } | null;
}

const tabs = new Map<number, TabState>();
let restored: Promise<void> | null = null;

const persist = debounce(() => {
  void chrome.storage.session?.set({ tabs: Object.fromEntries(tabs) });
}, 1000);

export function restoreTabs(): Promise<void> {
  restored ??= (async () => {
    try {
      const { tabs: saved } = (await chrome.storage.session.get('tabs')) as { tabs?: Record<string, TabState> };
      for (const [id, tab] of Object.entries(saved ?? {})) if (!tabs.has(Number(id))) tabs.set(Number(id), tab);
    } catch {
      /* storage.session unavailable */
    }
  })();
  return restored;
}

export function resetTab(tabId: number, url: string, hostname: string, site: string): TabState {
  const tab: TabState = { url, hostname, site, blocked: 0, domains: {}, fingerprint: {}, cookie: null };
  tabs.set(tabId, tab);
  persist();
  return tab;
}

export function getTab(tabId: number): TabState | undefined {
  return tabs.get(tabId);
}

export function removeTab(tabId: number): void {
  tabs.delete(tabId);
  persist();
}

function domain(tab: TabState, base: string): DomainStats {
  return (tab.domains[base] ??= { requests: 0, blocked: 0, tracking: false });
}

export function recordRequest(tabId: number, base: string): void {
  const tab = tabs.get(tabId);
  if (!tab) return;
  domain(tab, base).requests++;
  persist();
}

export function recordBlocked(tabId: number, base: string, thirdParty: boolean): void {
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.blocked++;
  if (thirdParty) domain(tab, base).blocked++;
  persist();
}

export function markTracking(tabId: number, base: string): void {
  const tab = tabs.get(tabId);
  if (!tab) return;
  domain(tab, base).tracking = true;
  persist();
}

export function recordFingerprint(tabId: number, api: string): void {
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.fingerprint[api] = (tab.fingerprint[api] ?? 0) + 1;
  persist();
}

export function recordCookie(tabId: number, cmp: string, action: string): void {
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.cookie = { cmp, action };
  persist();
}
