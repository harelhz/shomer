/**
 * Helpers shared by scriptlets. Scriptlets run in the page's MAIN world, at
 * document_start, before any page script. Built-ins are captured here, while
 * they are still pristine, so a page can't break a scriptlet later by
 * monkey-patching e.g. `RegExp.prototype.test`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const call = Function.prototype.call;
const bind = Function.prototype.bind;
const uncurry = <T extends (...args: any[]) => any>(fn: T) =>
  bind.call(call, fn) as (thisArg: unknown, ...args: Parameters<T>) => ReturnType<T>;

export const safe = {
  defineProperty: Object.defineProperty,
  getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  reTest: uncurry(RegExp.prototype.test),
  strReplace: uncurry(String.prototype.replace) as unknown as (s: string, a: RegExp | string, b: string) => string,
  jsonParse: JSON.parse,
  jsonStringify: JSON.stringify,
  setTimeout: window.setTimeout.bind(window),
  Error,
  RegExp,
  Proxy,
  Reflect,
  MutationObserver: window.MutationObserver,
};

/** Message used to recognise our own aborts in error handlers. */
export const ABORT_MAGIC = `shomer-${Math.random().toString(36).slice(2)}`;

let errorSuppressorInstalled = false;
/** Keeps scriptlet-triggered exceptions out of the console and page error handlers. */
export function installErrorSuppressor(): void {
  if (errorSuppressorInstalled) return;
  errorSuppressorInstalled = true;
  window.addEventListener(
    'error',
    (ev) => {
      if (String(ev.message).includes(ABORT_MAGIC)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },
    true,
  );
}

export function abortError(): Error {
  installErrorSuppressor();
  return new ReferenceError(ABORT_MAGIC);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * uBO pattern semantics: `/regex/flags` is a regex, anything else is a literal
 * substring, and the empty pattern matches everything.
 */
export function patternToRegex(pattern: string, defaultFlags = ''): RegExp {
  if (pattern === '') return /^/;
  const m = /^\/(.+)\/([gimsu]*)$/.exec(pattern);
  if (m?.[1] !== undefined) {
    try {
      return new safe.RegExp(m[1], m[2] || defaultFlags);
    } catch {
      /* fall through to a literal match */
    }
  }
  return new safe.RegExp(escapeRe(pattern), defaultFlags);
}

/** A needle that may be negated with a leading `!`. */
export interface Needle {
  re: RegExp;
  negated: boolean;
}

export function parseNeedle(pattern: string): Needle {
  const negated = pattern.startsWith('!');
  return { re: patternToRegex(negated ? pattern.slice(1) : pattern), negated };
}

export function needleMatches(needle: Needle, haystack: string): boolean {
  return safe.reTest(needle.re, haystack) !== needle.negated;
}

export function toText(value: unknown): string {
  try {
    if (typeof value === 'function') return Function.prototype.toString.call(value);
    return String(value);
  } catch {
    return '';
  }
}

/**
 * Runs `leaf(owner, prop)` on the object at the end of a dotted property
 * chain, even if intermediate objects don't exist yet: setters are installed
 * on the missing links and the chain is resumed once the page assigns them.
 */
export function onPropertyChain(root: any, chain: string, leaf: (owner: any, prop: string) => void): void {
  const dot = chain.indexOf('.');
  if (dot === -1) {
    leaf(root, chain);
    return;
  }
  const prop = chain.slice(0, dot);
  const rest = chain.slice(dot + 1);
  let current = root[prop];
  const isObject = (v: unknown) => v !== null && (typeof v === 'object' || typeof v === 'function');
  if (isObject(current)) onPropertyChain(current, rest, leaf);

  const desc = safe.getOwnPropertyDescriptor(root, prop);
  if (desc && (!desc.configurable || desc.get || desc.set)) return;
  try {
    safe.defineProperty(root, prop, {
      configurable: true,
      enumerable: desc?.enumerable ?? true,
      get() {
        return current;
      },
      set(v) {
        current = v;
        if (isObject(v)) onPropertyChain(v, rest, leaf);
      },
    });
  } catch {
    /* non-extensible object */
  }
}

/** Runs `fn` once the DOM is parsed (or immediately if it already is). */
export function onDomReady(fn: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

/**
 * Calls `fn` now, when the DOM is ready, and on every mutation (throttled) for
 * `durationMs` (or forever when `durationMs` is 0).
 */
export function observeDom(fn: () => void, durationMs = 0, observeAttributes = false): void {
  let scheduled = false;
  const run = () => {
    scheduled = false;
    try {
      fn();
    } catch {
      /* ignore */
    }
  };
  const observer = new safe.MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    safe.setTimeout(run, 16);
  });
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: observeAttributes });
    run();
  };
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
  onDomReady(run);
  if (durationMs > 0) safe.setTimeout(() => observer.disconnect(), durationMs);
}

/** Splits on commas that aren't inside parentheses, brackets or quotes. */
export function splitTopLevel(text: string, separator = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth--;
    } else if (c === separator && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/** `querySelector` that pierces open shadow roots with `>>>`. */
export function querySelectorDeep(selector: string, root: ParentNode = document): Element | null {
  const parts = selector.split(/\s*>>>\s*/);
  let context: ParentNode | null = root;
  for (let i = 0; i < parts.length; i++) {
    if (!context) return null;
    const el: Element | null = context.querySelector(parts[i] ?? '');
    if (!el) return null;
    if (i === parts.length - 1) return el;
    context = el.shadowRoot;
  }
  return null;
}

/** Replaces placeholders supported by trusted-* scriptlets. */
export function expandValuePlaceholders(value: string): string {
  return value
    .replace('$now$', String(Date.now()))
    .replace('$currentDate$', new Date().toUTCString())
    .replace('$currentISODate$', new Date().toISOString());
}

/**
 * Values that untrusted cookie / storage scriptlets may write. This keeps
 * a filter from planting an arbitrary identifier in a site's storage.
 */
const SAFE_VALUES = new Set([
  '',
  'true',
  'false',
  'yes',
  'y',
  'no',
  'n',
  'ok',
  'on',
  'off',
  'accept',
  'accepted',
  'notaccepted',
  'reject',
  'rejected',
  'allow',
  'allowed',
  'disallow',
  'deny',
  'denied',
  'necessary',
  'required',
  'approved',
  'disapproved',
  'hide',
  'hidden',
  'essential',
  'nonessential',
  'checked',
  'unchecked',
  'forbidden',
  'forever',
  'dismiss',
  'dismissed',
  'null',
  'undefined',
  'emptyarr',
  'emptyobj',
  '$remove$',
]);

export function isSafeValue(value: string): boolean {
  const v = value.toLowerCase();
  if (SAFE_VALUES.has(v)) return true;
  if (/^-?\d+$/.test(v)) return Math.abs(parseInt(v, 10)) <= 32767;
  return false;
}
