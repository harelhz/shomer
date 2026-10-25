/**
 * Scriptlet implementations.
 *
 * Each scriptlet is a small function that runs in the page's MAIN world at
 * document_start and neutralises one specific behaviour: an anti-adblock
 * check, an ad loader, a consent dialog, etc. Names and argument conventions
 * match uBlock Origin's so its lists work unchanged; the implementations are
 * Shomer's own.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  abortError,
  expandValuePlaceholders,
  isSafeValue,
  needleMatches,
  observeDom,
  onDomReady,
  onPropertyChain,
  parseNeedle,
  patternToRegex,
  querySelectorDeep,
  safe,
  splitTopLevel,
  toText,
} from './helpers';

type Scriptlet = (...args: string[]) => void;

const noop = function () {};

/* -------------------------------------------------------------------------- */
/* Property traps                                                               */
/* -------------------------------------------------------------------------- */

const INVALID = Symbol('invalid');

function resolveConstant(raw: string): unknown {
  switch (raw) {
    case 'undefined':
      return undefined;
    case 'false':
      return false;
    case 'true':
      return true;
    case 'null':
      return null;
    case "''":
    case '""':
    case '':
    case 'emptyStr':
      return '';
    case 'noopFunc':
      return function () {};
    case 'trueFunc':
      return function () {
        return true;
      };
    case 'falseFunc':
      return function () {
        return false;
      };
    case 'throwFunc':
      return function () {
        throw abortError();
      };
    case 'noopCallbackFunc':
      return function () {
        return noop;
      };
    case 'noopPromiseResolve':
      return function () {
        return Promise.resolve();
      };
    case 'noopPromiseReject':
      return function () {
        return Promise.reject(new Error());
      };
    case 'emptyArr':
      return [];
    case 'emptyObj':
      return {};
    case 'yes':
    case 'no':
      return raw;
  }
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  try {
    return safe.jsonParse(raw);
  } catch {
    return INVALID;
  }
}

const setConstant: Scriptlet = (chain = '', rawValue = '', ...extra) => {
  if (chain === '') return;
  let value = resolveConstant(rawValue);
  if (value === INVALID) return;
  const wrap = extra.find((e) => /^as(Function|Callback|Resolved|Rejected)$/.test(e));
  if (wrap === 'asFunction') {
    const v = value;
    value = () => v;
  } else if (wrap === 'asCallback') {
    const v = value;
    value = () => () => v;
  } else if (wrap === 'asResolved') {
    value = Promise.resolve(value);
  } else if (wrap === 'asRejected') {
    value = Promise.reject(value);
  }

  onPropertyChain(window, chain, (owner, prop) => {
    const desc = safe.getOwnPropertyDescriptor(owner, prop);
    if (desc && !desc.configurable) return;
    try {
      safe.defineProperty(owner, prop, {
        configurable: true,
        enumerable: desc?.enumerable ?? true,
        get: () => value,
        set: noop,
      });
    } catch {
      /* ignore */
    }
  });
};

const abortOnPropertyRead: Scriptlet = (chain = '') => {
  if (chain === '') return;
  onPropertyChain(window, chain, (owner, prop) => {
    try {
      safe.defineProperty(owner, prop, {
        configurable: true,
        get() {
          throw abortError();
        },
        set: noop,
      });
    } catch {
      /* ignore */
    }
  });
};

const abortOnPropertyWrite: Scriptlet = (chain = '') => {
  if (chain === '') return;
  onPropertyChain(window, chain, (owner, prop) => {
    let value = owner[prop];
    try {
      safe.defineProperty(owner, prop, {
        configurable: true,
        get: () => value,
        set(v) {
          value = undefined;
          void v;
          throw abortError();
        },
      });
    } catch {
      /* ignore */
    }
  });
};

/** Wraps a property so that `check()` runs on every read and write. */
function guardProperty(chain: string, check: () => void): void {
  onPropertyChain(window, chain, (owner, prop) => {
    const desc = safe.getOwnPropertyDescriptor(owner, prop);
    if (desc && !desc.configurable) return;
    let value = desc && 'value' in desc ? desc.value : owner[prop];
    try {
      safe.defineProperty(owner, prop, {
        configurable: true,
        enumerable: desc?.enumerable ?? true,
        get() {
          check();
          return desc?.get ? desc.get.call(this) : value;
        },
        set(v) {
          check();
          if (desc?.set) desc.set.call(this, v);
          else value = v;
        },
      });
    } catch {
      /* ignore */
    }
  });
}

function scriptText(el: HTMLScriptElement): string {
  const text = el.textContent ?? '';
  if (text.trim() !== '') return text;
  if (el.src.startsWith('data:')) {
    try {
      const comma = el.src.indexOf(',');
      const payload = el.src.slice(comma + 1);
      return el.src.slice(0, comma).includes(';base64') ? atob(payload) : decodeURIComponent(payload);
    } catch {
      return '';
    }
  }
  return '';
}

const abortCurrentScript: Scriptlet = (target = '', needle = '', context = '') => {
  if (target === '') return;
  const reNeedle = patternToRegex(needle);
  const reContext = patternToRegex(context);
  const thisScript = document.currentScript;
  guardProperty(target, () => {
    const el = document.currentScript;
    if (!(el instanceof HTMLScriptElement) || el === thisScript) return;
    if (context !== '' && !safe.reTest(reContext, el.src)) return;
    if (!safe.reTest(reNeedle, scriptText(el))) return;
    throw abortError();
  });
};

const abortOnStackTrace: Scriptlet = (chain = '', needle = '') => {
  if (chain === '' || needle === '') return;
  const re = patternToRegex(needle);
  guardProperty(chain, () => {
    const stack = (new safe.Error().stack ?? '')
      .split('\n')
      .filter((l) => !/(chrome|moz)-extension:\/\//.test(l))
      .join('\n');
    if (safe.reTest(re, stack)) throw abortError();
  });
};

/* -------------------------------------------------------------------------- */
/* API wrappers                                                                 */
/* -------------------------------------------------------------------------- */

function wrapMethod(owner: any, name: string, apply: (target: any, thisArg: any, args: any[]) => any): void {
  const original = owner?.[name];
  if (typeof original !== 'function') return;
  owner[name] = new safe.Proxy(original, { apply });
}

const preventAddEventListener: Scriptlet = (type = '', pattern = '') => {
  if (type === '' && pattern === '') return;
  const typeNeedle = parseNeedle(type);
  const handlerNeedle = parseNeedle(pattern);
  wrapMethod(EventTarget.prototype, 'addEventListener', (target, thisArg, args) => {
    const [evType, handler] = args;
    let text = '';
    try {
      text = toText(typeof handler === 'function' ? handler : handler?.handleEvent);
    } catch {
      /* ignore */
    }
    if (needleMatches(typeNeedle, String(evType)) && needleMatches(handlerNeedle, text)) return undefined;
    return safe.Reflect.apply(target, thisArg, args);
  });
};

function delayMatches(spec: string, delay: unknown): boolean {
  if (spec === '' || spec === '*') return true;
  const negated = spec.startsWith('!');
  const n = parseInt(negated ? spec.slice(1) : spec, 10);
  if (Number.isNaN(n)) return true;
  return (Number(delay) === n) !== negated;
}

function makeTimerDefuser(timer: 'setTimeout' | 'setInterval'): Scriptlet {
  return (needle = '', delay = '') => {
    const n = parseNeedle(needle);
    wrapMethod(window, timer, (target, thisArg, args) => {
      if (needleMatches(n, toText(args[0])) && delayMatches(delay, args[1])) args[0] = noop;
      return safe.Reflect.apply(target, thisArg, args);
    });
  };
}

function makeTimerBooster(timer: 'setTimeout' | 'setInterval'): Scriptlet {
  return (needle = '', delay = '1000', boost = '0.05') => {
    const n = parseNeedle(needle);
    const delayValue = delay === '*' ? -1 : parseInt(delay, 10) || 1000;
    let factor = parseFloat(boost);
    if (!Number.isFinite(factor)) factor = 0.05;
    factor = Math.min(50, Math.max(0.001, factor));
    wrapMethod(window, timer, (target, thisArg, args) => {
      if (needleMatches(n, toText(args[0])) && (delayValue === -1 || Number(args[1]) === delayValue)) {
        args[1] = Number(args[1] ?? 0) * factor;
      }
      return safe.Reflect.apply(target, thisArg, args);
    });
  };
}

const preventRequestAnimationFrame: Scriptlet = (needle = '') => {
  const n = parseNeedle(needle);
  wrapMethod(window, 'requestAnimationFrame', (target, thisArg, args) => {
    if (needleMatches(n, toText(args[0]))) args[0] = noop;
    return safe.Reflect.apply(target, thisArg, args);
  });
};

const preventWindowOpen: Scriptlet = (pattern = '', delay = '') => {
  const n = parseNeedle(pattern);
  const lifetime = Math.max(1, parseInt(delay, 10) || 10) * 1000;
  wrapMethod(window, 'open', (target, thisArg, args) => {
    if (!needleMatches(n, String(args[0] ?? ''))) return safe.Reflect.apply(target, thisArg, args);
    // Return a decoy window so scripts that check the return value don't
    // conclude a popup blocker is active.
    const frame = document.createElement('iframe');
    frame.style.setProperty('display', 'none', 'important');
    (document.body ?? document.documentElement).appendChild(frame);
    const decoy = frame.contentWindow;
    safe.setTimeout(() => frame.remove(), lifetime);
    return decoy;
  });
};

const preventEval: Scriptlet = (needle = '') => {
  const n = parseNeedle(needle);
  wrapMethod(window, 'eval', (target, thisArg, args) => {
    if (needleMatches(n, String(args[0]))) return undefined;
    return safe.Reflect.apply(target, thisArg, args);
  });
};

/** Parses `url:/ads/ method:POST` or a bare URL pattern. */
function parsePropsToMatch(text: string): Map<string, ReturnType<typeof parseNeedle>> {
  const props = new Map<string, ReturnType<typeof parseNeedle>>();
  if (text === '' || text === '*') return props;
  for (const part of text.split(/\s+/)) {
    const m = /^(\w+):(.+)$/.exec(part);
    if (m?.[1] && m[2] !== undefined) props.set(m[1], parseNeedle(m[2]));
    else props.set('url', parseNeedle(part));
  }
  return props;
}

function propsMatch(props: Map<string, ReturnType<typeof parseNeedle>>, details: Record<string, unknown>): boolean {
  for (const [key, needle] of props) {
    if (!needleMatches(needle, String(details[key] ?? ''))) return false;
  }
  return true;
}

function responseBodyFor(spec: string): string {
  switch (spec) {
    case 'emptyObj':
      return '{}';
    case 'emptyArr':
      return '[]';
    case 'emptyStr':
    case '':
      return '';
    case 'true':
    case 'false':
      return spec;
    default:
      return spec;
  }
}

const preventFetch: Scriptlet = (propsToMatch = '', responseBody = '') => {
  const props = parsePropsToMatch(propsToMatch);
  if (props.size === 0 && propsToMatch === '') return;
  const body = responseBodyFor(responseBody);
  wrapMethod(window, 'fetch', (target, thisArg, args) => {
    const [resource, init] = args;
    const details: Record<string, unknown> = {};
    try {
      if (resource instanceof Request) {
        details.url = resource.url;
        details.method = resource.method;
      } else {
        details.url = String(resource);
      }
      if (init && typeof init === 'object') Object.assign(details, init);
    } catch {
      /* ignore */
    }
    if (!propsMatch(props, details)) return safe.Reflect.apply(target, thisArg, args);
    const response = new Response(body, { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/plain' } });
    try {
      safe.defineProperty(response, 'url', { value: String(details.url ?? '') });
      safe.defineProperty(response, 'type', { value: 'basic' });
    } catch {
      /* ignore */
    }
    return Promise.resolve(response);
  });
};

const preventXhr: Scriptlet = (propsToMatch = '') => {
  const props = parsePropsToMatch(propsToMatch);
  if (props.size === 0 && propsToMatch === '') return;
  const blocked = new WeakMap<XMLHttpRequest, string>();
  const proto = XMLHttpRequest.prototype;
  wrapMethod(proto, 'open', (target, thisArg, args) => {
    const [method, url] = args;
    if (propsMatch(props, { method, url: String(url) })) blocked.set(thisArg, String(url));
    else blocked.delete(thisArg);
    return safe.Reflect.apply(target, thisArg, args);
  });
  wrapMethod(proto, 'send', (target, thisArg: XMLHttpRequest, args) => {
    const url = blocked.get(thisArg);
    if (url === undefined) return safe.Reflect.apply(target, thisArg, args);
    const define = (name: string, value: unknown) => {
      try {
        safe.defineProperty(thisArg, name, { value, configurable: true });
      } catch {
        /* ignore */
      }
    };
    define('readyState', 4);
    define('status', 200);
    define('statusText', 'OK');
    define('responseURL', url);
    define('response', thisArg.responseType === 'json' ? null : '');
    define('responseText', '');
    safe.setTimeout(() => {
      for (const type of ['readystatechange', 'load', 'loadend']) thisArg.dispatchEvent(new Event(type));
    }, 1);
    return undefined;
  });
};

/* -------------------------------------------------------------------------- */
/* JSON pruning                                                                 */
/* -------------------------------------------------------------------------- */

/** Removes `a.b.c`-style paths; `[]` or `*` matches any key at that level. */
function prunePath(obj: any, segments: string[]): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  const [head, ...rest] = segments;
  if (head === undefined) return false;
  const keys = head === '[]' || head === '*' ? Object.keys(obj) : [head];
  let pruned = false;
  for (const key of keys) {
    if (!(key in obj)) continue;
    if (rest.length === 0) {
      delete obj[key];
      pruned = true;
    } else if (prunePath(obj[key], rest)) {
      pruned = true;
    }
  }
  return pruned;
}

function hasPath(obj: any, segments: string[]): boolean {
  if (segments.length === 0) return true;
  if (obj === null || typeof obj !== 'object') return false;
  const [head, ...rest] = segments;
  if (head === '[]' || head === '*') return Object.keys(obj).some((k) => hasPath(obj[k], rest));
  return head !== undefined && head in obj && hasPath(obj[head], rest);
}

const toSegments = (path: string) => path.replace(/\[\]/g, '.[]').split('.').filter(Boolean);

const jsonPrune: Scriptlet = (propsToRemove = '', requiredPaths = '') => {
  if (propsToRemove === '') return;
  const remove = propsToRemove.split(/\s+/).filter(Boolean).map(toSegments);
  const required = requiredPaths.split(/\s+/).filter(Boolean).map(toSegments);
  const prune = (obj: unknown) => {
    try {
      if (required.every((r) => hasPath(obj, r))) for (const p of remove) prunePath(obj, p);
    } catch {
      /* ignore */
    }
    return obj;
  };
  wrapMethod(JSON, 'parse', (target, thisArg, args) => prune(safe.Reflect.apply(target, thisArg, args)));
  wrapMethod(Response.prototype, 'json', (target, thisArg, args) =>
    (safe.Reflect.apply(target, thisArg, args) as Promise<unknown>).then(prune),
  );
};

/* -------------------------------------------------------------------------- */
/* Cookies & storage                                                            */
/* -------------------------------------------------------------------------- */

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(/;\s*/)) {
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key === name) return eq === -1 ? '' : part.slice(eq + 1);
  }
  return null;
}

function writeCookie(name: string, value: string, path: string, expiresSec?: number): boolean {
  if (/[;\s]/.test(name) || value.includes(';')) return false;
  let cookie = `${name}=${value}`;
  if (path !== 'none') cookie += `; path=${path || '/'}`;
  if (expiresSec !== undefined) cookie += `; expires=${new Date(Date.now() + expiresSec * 1000).toUTCString()}`;
  if (location.protocol === 'https:') cookie += '; Secure; SameSite=Lax';
  try {
    document.cookie = cookie;
  } catch {
    return false;
  }
  return readCookie(name) === value;
}

function makeSetCookie(trusted: boolean, reload: boolean): Scriptlet {
  return (name = '', rawValue = '', third = '', fourth = '') => {
    if (name === '') return;
    let value: string;
    let expires: number | undefined;
    let path: string;
    if (trusted) {
      value = expandValuePlaceholders(rawValue);
      const offset = third.trim();
      if (offset === '1day') expires = 86400;
      else if (offset === '1year') expires = 31536000;
      else if (/^\d+$/.test(offset)) expires = parseInt(offset, 10);
      path = fourth;
    } else {
      if (!isSafeValue(rawValue)) return;
      value = encodeURIComponent(rawValue);
      path = third;
    }
    if (readCookie(name) === value) return;
    const wasSet = readCookie(name) !== null;
    if (writeCookie(name, value, path, expires) && reload && !wasSet) location.reload();
  };
}

function makeSetStorageItem(kind: 'localStorage' | 'sessionStorage', trusted: boolean): Scriptlet {
  return (key = '', rawValue = '') => {
    if (key === '') return;
    let storage: Storage;
    try {
      storage = window[kind];
    } catch {
      return;
    }
    if (rawValue === '$remove$' || rawValue === 'undefined') {
      storage.removeItem(key);
      return;
    }
    let value: string;
    if (trusted) {
      value = expandValuePlaceholders(rawValue);
    } else {
      if (!isSafeValue(rawValue)) return;
      value = rawValue === 'emptyArr' ? '[]' : rawValue === 'emptyObj' ? '{}' : rawValue;
    }
    try {
      storage.setItem(key, value);
    } catch {
      /* quota or disabled */
    }
  };
}

const cookieRemover: Scriptlet = (needle = '') => {
  const re = patternToRegex(needle);
  const remove = () => {
    for (const part of document.cookie.split(/;\s*/)) {
      const name = part.split('=', 1)[0] ?? '';
      if (name === '' || !safe.reTest(re, name)) continue;
      const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      const labels = location.hostname.split('.');
      for (let i = 0; i < labels.length - 1; i++) {
        const domain = labels.slice(i).join('.');
        document.cookie = `${expired}; path=/; domain=${domain}`;
        document.cookie = `${expired}; path=/; domain=.${domain}`;
      }
      document.cookie = `${expired}; path=/`;
      document.cookie = expired;
    }
  };
  remove();
  onDomReady(remove);
  window.addEventListener('beforeunload', remove);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') remove();
  });
};

/* -------------------------------------------------------------------------- */
/* DOM                                                                          */
/* -------------------------------------------------------------------------- */

function checkExtraMatch(spec: string): boolean {
  for (let cond of splitTopLevel(spec)) {
    const negated = cond.startsWith('!');
    if (negated) cond = cond.slice(1);
    const m = /^(cookie|localStorage):(.+)$/.exec(cond);
    if (!m?.[1] || !m[2]) continue;
    const re = patternToRegex(m[2]);
    let found = false;
    if (m[1] === 'cookie') {
      found = document.cookie.split(/;\s*/).some((c) => safe.reTest(re, c.split('=', 1)[0] ?? ''));
    } else {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          if (safe.reTest(re, localStorage.key(i) ?? '')) found = true;
        }
      } catch {
        /* storage disabled */
      }
    }
    if (found === negated) return false;
  }
  return true;
}

const trustedClickElement: Scriptlet = (selectors = '', extraMatch = '', delay = '') => {
  const queue = splitTopLevel(selectors);
  if (queue.length === 0) return;
  if (extraMatch !== '' && !checkExtraMatch(extraMatch)) return;
  const pause = Math.min(10000, Math.max(100, parseInt(delay, 10) || 100));
  const deadline = Date.now() + 10000;
  let busy = false;

  const step = () => {
    if (busy || queue.length === 0 || Date.now() > deadline) return;
    const el = querySelectorDeep(queue[0] ?? '');
    if (!el) return;
    busy = true;
    // Give the page a moment to attach its handlers before clicking.
    safe.setTimeout(() => {
      busy = false;
      if (el.isConnected && el instanceof HTMLElement) {
        el.click();
        queue.shift();
      }
      step();
    }, pause);
  };
  observeDom(step, 10000, true);
};

function runOnElements(selector: string, behavior: string, fn: (el: Element) => void): void {
  const apply = () => {
    try {
      document.querySelectorAll(selector).forEach(fn);
    } catch {
      /* invalid selector */
    }
  };
  if (behavior.includes('asap')) apply();
  if (behavior.includes('stay')) observeDom(apply, 0, true);
  else if (behavior.includes('complete')) window.addEventListener('load', apply, { once: true });
  else observeDom(apply, 10000, true);
}

const removeAttr: Scriptlet = (attrs = '', selector = '', behavior = '') => {
  const names = attrs.split(/\s*\|\s*/).filter(Boolean);
  if (names.length === 0) return;
  const sel = selector || names.map((a) => `[${a}]`).join(',');
  runOnElements(sel, behavior, (el) => names.forEach((a) => el.removeAttribute(a)));
};

const removeClass: Scriptlet = (classes = '', selector = '', behavior = '') => {
  const names = classes.split(/\s*\|\s*/).filter(Boolean);
  if (names.length === 0) return;
  const sel = selector || names.map((c) => `.${CSS.escape(c)}`).join(',');
  runOnElements(sel, behavior, (el) => el.classList.remove(...names));
};

const setAttr: Scriptlet = (selector = '', attr = '', value = '') => {
  if (selector === '' || attr === '' || /^on/i.test(attr)) return;
  const copyFrom = /^\[([\w-]+)\]$/.exec(value)?.[1];
  if (!copyFrom && !isSafeValue(value)) return;
  runOnElements(selector, 'stay', (el) => {
    const v = copyFrom ? el.getAttribute(copyFrom) : value;
    if (v !== null && el.getAttribute(attr) !== v) el.setAttribute(attr, v);
  });
};

function observeTextNodes(nodeName: string, onNode: (node: Node) => void): void {
  const reNode = patternToRegex(nodeName, 'i');
  const visit = (node: Node) => {
    if (safe.reTest(reNode, node.nodeName)) onNode(node);
  };
  const observer = new safe.MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        visit(node);
        if (node.nodeType === Node.TEXT_NODE && node.parentNode) visit(node.parentNode);
      }
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  document.querySelectorAll('*').forEach(visit);
}

const removeNodeText: Scriptlet = (nodeName = '', pattern = '') => {
  if (nodeName === '' || pattern === '') return;
  const re = patternToRegex(pattern);
  observeTextNodes(nodeName, (node) => {
    if (safe.reTest(re, node.textContent ?? '')) node.textContent = '';
  });
};

const replaceNodeText: Scriptlet = (nodeName = '', pattern = '', replacement = '', ...extra) => {
  if (nodeName === '' || pattern === '') return;
  const re = patternToRegex(pattern);
  const conditionIndex = extra.indexOf('condition');
  const condition = conditionIndex !== -1 ? patternToRegex(extra[conditionIndex + 1] ?? '') : null;
  observeTextNodes(nodeName, (node) => {
    const text = node.textContent ?? '';
    if (condition && !safe.reTest(condition, text)) return;
    const next = safe.strReplace(text, re, replacement);
    if (next !== text) node.textContent = next;
  });
};

const hrefSanitizer: Scriptlet = (selector = '', source = 'text') => {
  if (selector === '') return;
  const sanitize = (el: Element) => {
    if (!(el instanceof HTMLAnchorElement)) return;
    let candidate: string | null = null;
    if (source === 'text' || source === '') candidate = el.textContent?.trim() ?? null;
    else if (source.startsWith('?')) {
      try {
        candidate = new URL(el.href).searchParams.get(source.slice(1));
      } catch {
        /* ignore */
      }
    } else if (/^\[[\w-]+\]$/.test(source)) candidate = el.getAttribute(source.slice(1, -1));
    if (!candidate || !/^https?:\/\//.test(candidate)) return;
    try {
      el.href = new URL(candidate).href;
    } catch {
      /* invalid URL */
    }
  };
  runOnElements(selector, 'stay', sanitize);
};

const refreshDefuser: Scriptlet = () => {
  runOnElements('meta[http-equiv="refresh" i]', '', (el) => el.remove());
};

const disableNewtabLinks: Scriptlet = () => {
  document.addEventListener(
    'click',
    (ev) => {
      const link = (ev.target as Element | null)?.closest?.('a[target]');
      if (link) link.removeAttribute('target');
    },
    true,
  );
};

/* -------------------------------------------------------------------------- */
/* Misc                                                                         */
/* -------------------------------------------------------------------------- */

const nowebrtc: Scriptlet = () => {
  const Stub = function (this: any) {
    this.localDescription = null;
    this.remoteDescription = null;
  } as unknown as { prototype: Record<string, unknown> };
  Stub.prototype = {
    close: noop,
    createDataChannel: noop,
    createOffer: () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')),
    createAnswer: () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')),
    setLocalDescription: () => Promise.resolve(),
    setRemoteDescription: () => Promise.resolve(),
    addIceCandidate: () => Promise.resolve(),
    addEventListener: noop,
    removeEventListener: noop,
    getStats: () => Promise.resolve(new Map()),
  };
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
    if (name in window) (window as any)[name] = Stub;
  }
};

const fuckadblockDefuser: Scriptlet = () => {
  function Detector(this: any) {}
  const proto = Detector.prototype as Record<string, unknown>;
  proto.check = noop;
  proto.clearEvent = noop;
  proto.emitEvent = noop;
  proto.setOption = noop;
  proto.on = function (this: unknown, detected: boolean, fn: () => void) {
    if (!detected) fn();
    return this;
  };
  proto.onDetected = function (this: unknown) {
    return this;
  };
  proto.onNotDetected = function (this: unknown, fn: () => void) {
    fn();
    return this;
  };
  const instance = new (Detector as any)();
  for (const [name, value] of [
    ['FuckAdBlock', Detector],
    ['BlockAdBlock', Detector],
    ['fuckAdBlock', instance],
    ['blockAdBlock', instance],
  ] as const) {
    try {
      safe.defineProperty(window, name, { value, writable: false, configurable: false });
    } catch {
      /* already defined */
    }
  }
};

export const SCRIPTLETS: Record<string, Scriptlet> = {
  'set-constant': setConstant,
  'abort-on-property-read': abortOnPropertyRead,
  'abort-on-property-write': abortOnPropertyWrite,
  'abort-current-script': abortCurrentScript,
  'abort-on-stack-trace': abortOnStackTrace,
  'prevent-addEventListener': preventAddEventListener,
  'prevent-setTimeout': makeTimerDefuser('setTimeout'),
  'prevent-setInterval': makeTimerDefuser('setInterval'),
  'adjust-setTimeout': makeTimerBooster('setTimeout'),
  'adjust-setInterval': makeTimerBooster('setInterval'),
  'prevent-requestAnimationFrame': preventRequestAnimationFrame,
  'prevent-window-open': preventWindowOpen,
  'prevent-eval': preventEval,
  'prevent-fetch': preventFetch,
  'prevent-xhr': preventXhr,
  'json-prune': jsonPrune,
  'set-cookie': makeSetCookie(false, false),
  'set-cookie-reload': makeSetCookie(false, true),
  'trusted-set-cookie': makeSetCookie(true, false),
  'trusted-set-cookie-reload': makeSetCookie(true, true),
  'set-local-storage-item': makeSetStorageItem('localStorage', false),
  'trusted-set-local-storage-item': makeSetStorageItem('localStorage', true),
  'set-session-storage-item': makeSetStorageItem('sessionStorage', false),
  'trusted-set-session-storage-item': makeSetStorageItem('sessionStorage', true),
  'cookie-remover': cookieRemover,
  'trusted-click-element': trustedClickElement,
  'remove-attr': removeAttr,
  'remove-class': removeClass,
  'set-attr': setAttr,
  'remove-node-text': removeNodeText,
  'replace-node-text': replaceNodeText,
  'href-sanitizer': hrefSanitizer,
  'refresh-defuser': refreshDefuser,
  'disable-newtab-links': disableNewtabLinks,
  nowebrtc,
  'fuckadblock-defuser': fuckadblockDefuser,
};
