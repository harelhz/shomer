/**
 * Network observers. In MV3 webRequest can no longer block, but it can still
 * observe — which is all tracker learning needs. Blocking is done by DNR.
 */
import { hostnameOf } from '../shared/util';
import { updateBadgeSoon } from './badge';
import { noteTracking } from './learning';
import { psl, saveStatsSoon, state } from './state';
import { getTab, recordBlocked, recordRequest, resetTab } from './tabs';
import { hasIdentifyingCookie, isIdentifyingValue, isSameParty, setCookieValue } from './tracker-logic';

const FILTER: chrome.webRequest.RequestFilter = { urls: ['http://*/*', 'https://*/*'] };
const BLOCKED_ERROR_RE = /BLOCKED_BY_CLIENT|BLOCKED_BY_POLICY|NS_ERROR_ABORT_BY_EXTENSION/;

function supportsExtraHeaders(): boolean {
  const options = chrome.webRequest.OnBeforeSendHeadersOptions as unknown as Record<string, string> | undefined;
  return !!options && Object.values(options).includes('extraHeaders');
}

interface Classified {
  tabId: number;
  base: string;
  site: string;
  thirdParty: boolean;
}

function classify(details: { tabId: number; url: string; frameId: number; initiator?: string }): Classified | null {
  if (details.tabId < 0) return null;
  let tab = getTab(details.tabId);
  if (!tab && details.frameId === 0 && details.initiator) {
    // The tab was open before the service worker (re)started.
    const host = hostnameOf(details.initiator);
    if (host) tab = resetTab(details.tabId, details.initiator, host, psl.getDomain(host));
  }
  if (!tab) return null;
  const host = hostnameOf(details.url);
  if (!host) return null;
  const base = psl.getDomain(host);
  return { tabId: details.tabId, base, site: tab.site, thirdParty: !isSameParty(base, tab.site) };
}

export function installWebRequestObservers(): void {
  const extra = supportsExtraHeaders();

  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId < 0) return;
    if (details.type === 'main_frame') {
      const host = hostnameOf(details.url);
      resetTab(details.tabId, details.url, host, psl.getDomain(host));
      updateBadgeSoon(details.tabId);
      return;
    }
    const c = classify(details);
    if (c?.thirdParty) recordRequest(c.tabId, c.base);
  }, FILTER);

  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const c = classify(details);
      if (!c?.thirdParty) return;
      const cookie = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'cookie')?.value;
      if (cookie && hasIdentifyingCookie(cookie)) noteTracking(c.tabId, c.base, c.site, 'cookie');
    },
    FILTER,
    extra ? ['requestHeaders', 'extraHeaders'] : ['requestHeaders'],
  );

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      const c = classify(details);
      if (!c?.thirdParty) return;
      const identifying = details.responseHeaders?.some(
        (h) => h.name.toLowerCase() === 'set-cookie' && isIdentifyingValue(setCookieValue(h.value ?? '')),
      );
      if (identifying) noteTracking(c.tabId, c.base, c.site, 'cookie');
    },
    FILTER,
    extra ? ['responseHeaders', 'extraHeaders'] : ['responseHeaders'],
  );

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    if (!BLOCKED_ERROR_RE.test(details.error)) return;
    const c = classify(details);
    if (!c) return;
    recordBlocked(c.tabId, c.base, c.thirdParty);
    updateBadgeSoon(c.tabId);
    state.stats.blocked++;
    saveStatsSoon();
  }, FILTER);
}
