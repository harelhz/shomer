/**
 * Cookie-banner engine (isolated world).
 *
 * 1. Known consent platforms: follow the rule's steps to *reject* consent.
 * 2. Unknown banners: find a fixed-position element that talks about cookies
 *    and click its "reject" / "necessary only" button, in 15+ languages
 *    including Hebrew.
 * 3. If there's no way to refuse, hide the banner and restore scrolling.
 *
 * Shomer never clicks "accept".
 */
import { CMP_RULES, REJECT_TEXT, type CmpRule, type CmpStep } from '../data/cookie-rules';

export type CookieReport = (cmp: string, action: 'rejected' | 'hidden') => void;

const REJECT_RE = new RegExp(REJECT_TEXT, 'i');
const COOKIE_TEXT_RE = /cookie|עוגי|קובצי|consent|gdpr|datenschutz|galleta|biscotti|ciasteczk/i;
const CANDIDATES =
  '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],' +
  '[id*="privacy" i],[class*="privacy" i],[id*="notice" i],[class*="notice" i],[id*="banner" i],[class*="banner" i],' +
  '[aria-label*="cookie" i],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
const BUTTONS = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
const ENGINE_LIFETIME_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** querySelector over a comma-separated list, each part may pierce shadow roots with `>>>`. */
export function queryDeep(selectorList: string, root: ParentNode = document): Element | null {
  for (const selector of selectorList.split(/,(?![^(]*\))(?![^[]*\])/)) {
    const parts = selector.trim().split(/\s*>>>\s*/);
    let context: ParentNode | null = root;
    let found: Element | null = null;
    for (let i = 0; i < parts.length && context; i++) {
      try {
        found = context.querySelector(parts[i] ?? '');
      } catch {
        found = null;
      }
      if (!found) break;
      context = i < parts.length - 1 ? found.shadowRoot : null;
    }
    if (found && context === null) return found;
  }
  return null;
}

function isRendered(el: Element): boolean {
  return getComputedStyle(el).display !== 'none';
}

function labelOf(el: Element): string {
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return (
    text ||
    (el as HTMLInputElement).value ||
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    ''
  ).trim();
}

export function findRejectButton(container: ParentNode, re: RegExp = REJECT_RE): HTMLElement | null {
  for (const el of Array.from(container.querySelectorAll(BUTTONS))) {
    const label = labelOf(el);
    if (label.length > 0 && label.length < 60 && re.test(label)) return el as HTMLElement;
  }
  return null;
}

async function waitFor<T>(probe: () => T | null, timeout: number): Promise<T | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const result = probe();
    if (result) return result;
    if (Date.now() > deadline) return null;
    await sleep(100);
  }
}

function click(el: Element): void {
  (el as HTMLElement).click();
}

export async function runSteps(steps: readonly CmpStep[]): Promise<boolean> {
  for (const step of steps) {
    if ('wait' in step) {
      await sleep(step.wait);
    } else if ('if' in step) {
      const branch = queryDeep(step.if) ? step.then : (step.else ?? []);
      if (!(await runSteps(branch))) return false;
    } else if ('click' in step) {
      const el = await waitFor(() => queryDeep(step.click), step.timeout ?? 2000);
      if (!el) {
        if (step.optional) continue;
        return false;
      }
      click(el);
      await sleep(300);
    } else if ('clickText' in step) {
      const re = new RegExp(step.clickText, 'i');
      const el = await waitFor(() => {
        const scope = queryDeep(step.within);
        return scope ? findRejectButton(scope, re) : null;
      }, step.timeout ?? 2000);
      if (!el) {
        if (step.optional) continue;
        return false;
      }
      click(el);
      await sleep(300);
    } else {
      const el = await waitFor(() => queryDeep(step.waitFor), step.timeout ?? 2000);
      if (!el && !step.optional) return false;
    }
  }
  return true;
}

function ruleApplies(rule: CmpRule): boolean {
  if (rule.hosts && !new RegExp(rule.hosts).test(location.hostname)) return false;
  if (rule.frame) return window !== window.top && new RegExp(rule.frame).test(location.href);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Generic heuristic                                                            */
/* -------------------------------------------------------------------------- */

function fixedAncestor(el: Element): HTMLElement | null {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 6; depth++, cur = cur.parentElement) {
    if (cur === document.body || cur === document.documentElement) return null;
    const position = getComputedStyle(cur).position;
    if (position === 'fixed' || position === 'sticky') return cur as HTMLElement;
  }
  return null;
}

/** Finds an on-screen, fixed-position element that is about cookies. */
export function findGenericBanner(handled: WeakSet<Element>): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll(CANDIDATES))) {
    const container = fixedAncestor(el);
    if (!container || handled.has(container) || !isRendered(container)) continue;
    const text = container.textContent ?? '';
    if (text.length < 20 || text.length > 3000 || !COOKIE_TEXT_RE.test(text)) continue;
    // Login and sign-up dialogs often mention cookies too; never touch forms.
    if (container.querySelector('input[type="password"], input[type="email"], input[type="text"], textarea, select'))
      continue;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    return container;
  }
  return null;
}

function unlockScroll(): void {
  for (const el of [document.documentElement, document.body]) {
    if (el && getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
  }
}

function hide(el: HTMLElement): void {
  el.style.setProperty('display', 'none', 'important');
  unlockScroll();
}

/* -------------------------------------------------------------------------- */

export function startCookieEngine(mode: 'reject' | 'hide', report: CookieReport): void {
  const started = Date.now();
  const handledRules = new Set<string>();
  const handledBanners = new WeakSet<Element>();
  const rules = CMP_RULES.filter(ruleApplies);
  let busy = false;

  const tick = async () => {
    if (busy || Date.now() - started > ENGINE_LIFETIME_MS) return;
    busy = true;
    try {
      if (mode === 'reject') {
        for (const rule of rules) {
          if (handledRules.has(rule.id)) continue;
          const dialog = queryDeep(rule.detect);
          if (!dialog || !isRendered(dialog)) continue;
          handledRules.add(rule.id);
          const ok = await runSteps(rule.reject);
          report(rule.name, ok ? 'rejected' : 'hidden');
          unlockScroll();
        }
      }
      // Give known CMPs a head start before falling back to the heuristic.
      if (Date.now() - started < 1500) return;
      const banner = findGenericBanner(handledBanners);
      if (!banner) return;
      handledBanners.add(banner);
      const button = mode === 'reject' ? findRejectButton(banner) : null;
      if (button) {
        click(button);
        report('Generic banner', 'rejected');
        await sleep(500);
        if (banner.isConnected && isRendered(banner)) hide(banner);
      } else {
        hide(banner);
        report('Generic banner', 'hidden');
      }
    } finally {
      busy = false;
    }
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      void tick();
    }, 250);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), ENGINE_LIFETIME_MS);
  // The heuristic waits 1.5 s; make sure it gets a chance on static pages.
  setTimeout(schedule, 1600);
  schedule();
}
