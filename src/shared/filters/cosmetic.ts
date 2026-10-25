/**
 * Cosmetic filter compilation and matching.
 *
 * Generic selectors are split in two, the way uBlock Origin does it:
 *
 *  - "lowly generic" selectors start with a class or id (`.ad-banner > img`).
 *    They are indexed by that token and only injected once the content script
 *    reports an element with that class/id on the page. EasyList has ~20k of
 *    these, and injecting all of them into every frame would be wasteful.
 *  - "highly generic" selectors (`a[href*="doubleclick"]`) can't be indexed and
 *    are always injected.
 */
import type { CosmeticFilter, ScriptletFilter } from './parser';

export interface CosmeticBundle {
  lowly: Record<string, string[]>;
  high: string[];
  /** Generic exceptions (`#@#.sel` with no domain) — applied across all lists. */
  genericExceptions: string[];
  /** hostname or entity (`example.*`) → selectors to hide or style. */
  specific: Record<string, string[]>;
  /** hostname or entity → selectors that must *not* be applied there. */
  exceptions: Record<string, string[]>;
  /** hostname or entity → procedural selectors (run by the content script). */
  procedural: Record<string, string[]>;
  /** Hostnames where cosmetic filtering is disabled entirely (`$elemhide`). */
  elemhide: string[];
  /** Hostnames where generic cosmetic filters are disabled (`$generichide`). */
  generichide: string[];
  /** Hostnames where specific cosmetic filters are disabled (`$specifichide`). */
  specifichide: string[];
}

export interface ScriptletBundle {
  /** hostname → [name, ...args] invocations */
  entries: Record<string, string[][]>;
  /** hostname → invocation keys (JSON of [name, ...args]) to suppress, or '*' for all. */
  exceptions: Record<string, string[]>;
}

export function emptyCosmeticBundle(): CosmeticBundle {
  return {
    lowly: {},
    high: [],
    genericExceptions: [],
    specific: {},
    exceptions: {},
    procedural: {},
    elemhide: [],
    generichide: [],
    specifichide: [],
  };
}

export function emptyScriptletBundle(): ScriptletBundle {
  return { entries: {}, exceptions: {} };
}

const LOWLY_KEY_RE = /^([.#])((?:[a-zA-Z_-]|\\.)(?:[\w-]|\\.)*)/;

/**
 * Returns the class/id token a generic selector can be indexed by, or null if
 * the selector is "highly generic". Only simple, unescaped tokens qualify.
 */
export function lowlyGenericKey(selector: string): string | null {
  const m = LOWLY_KEY_RE.exec(selector);
  if (!m || m[0].includes('\\')) return null;
  const next = selector.charAt(m[0].length);
  if (next !== '' && !' >+~.:#['.includes(next)) return null;
  // A top-level selector list can't be keyed by its first member.
  if (hasTopLevelComma(selector)) return null;
  return m[0];
}

function hasTopLevelComma(selector: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '\\') {
      i++;
    } else if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 0) {
      return true;
    }
  }
  return false;
}

function push(map: Record<string, string[]>, key: string, value: string): void {
  (map[key] ??= []).push(value);
}

export function addCosmeticFilter(bundle: CosmeticBundle, f: CosmeticFilter): void {
  const { include, exclude } = f.domains;

  if (f.exception) {
    if (include.length === 0) bundle.genericExceptions.push(f.selector);
    for (const d of include) push(bundle.exceptions, d, f.selector);
    return;
  }

  if (include.length === 0) {
    // Generic filter, possibly with exclusions: `~example.com##.ad`
    const key = lowlyGenericKey(f.selector);
    if (key) push(bundle.lowly, key, f.selector);
    else bundle.high.push(f.selector);
  } else {
    const target = f.procedural ? bundle.procedural : bundle.specific;
    for (const d of include) push(target, d, f.selector);
  }
  for (const d of exclude) push(bundle.exceptions, d, f.selector);
}

export function addScriptletFilter(bundle: ScriptletBundle, f: ScriptletFilter, canonicalName: string): void {
  const invocation = [canonicalName, ...f.args];
  const key = f.name === '' ? '*' : JSON.stringify(invocation);
  if (f.exception) {
    for (const d of f.domains.include) push(bundle.exceptions, d, key);
    return;
  }
  for (const d of f.domains.include) (bundle.entries[d] ??= []).push(invocation);
  for (const d of f.domains.exclude) push(bundle.exceptions, d, key);
}

/** Sorts and deduplicates every list so output is deterministic. */
export function finalizeCosmeticBundle(b: CosmeticBundle): CosmeticBundle {
  const uniq = (a: string[]) => [...new Set(a)].sort();
  const uniqMap = (m: Record<string, string[]>) =>
    Object.fromEntries(
      Object.keys(m)
        .sort()
        .map((k) => [k, uniq(m[k] ?? [])]),
    );
  return {
    lowly: uniqMap(b.lowly),
    high: uniq(b.high),
    genericExceptions: uniq(b.genericExceptions),
    specific: uniqMap(b.specific),
    exceptions: uniqMap(b.exceptions),
    procedural: uniqMap(b.procedural),
    elemhide: uniq(b.elemhide),
    generichide: uniq(b.generichide),
    specifichide: uniq(b.specifichide),
  };
}

export function finalizeScriptletBundle(b: ScriptletBundle): ScriptletBundle {
  const entries: Record<string, string[][]> = {};
  for (const host of Object.keys(b.entries).sort()) {
    const seen = new Set<string>();
    entries[host] = (b.entries[host] ?? []).filter((inv) => {
      const k = JSON.stringify(inv);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const exceptions: Record<string, string[]> = {};
  for (const host of Object.keys(b.exceptions).sort()) exceptions[host] = [...new Set(b.exceptions[host])].sort();
  return { entries, exceptions };
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * All the keys a hostname can match: itself, every parent domain, and the
 * corresponding entities (`www.example.co.uk` → `www.example.*`, `example.*`).
 */
export function hostnameKeys(hostname: string, publicSuffix: string): string[] {
  const keys: string[] = [];
  let h = hostname;
  for (;;) {
    keys.push(h);
    const dot = h.indexOf('.');
    if (dot === -1) break;
    h = h.slice(dot + 1);
  }
  if (publicSuffix && hostname.endsWith(`.${publicSuffix}`)) {
    let base = hostname.slice(0, -(publicSuffix.length + 1));
    for (;;) {
      keys.push(`${base}.*`);
      const dot = base.indexOf('.');
      if (dot === -1) break;
      base = base.slice(dot + 1);
    }
  }
  return keys;
}

export interface CosmeticQueryResult {
  /** Selectors to hide (may include `:style()` entries). */
  selectors: string[];
  procedural: string[];
  /** Whether generic filters may be applied on this page. */
  generic: boolean;
  /** Exceptions that apply to this page; needed to filter lowly-generic lookups. */
  exceptions: Set<string>;
}

export function queryCosmetics(bundles: readonly CosmeticBundle[], keys: readonly string[]): CosmeticQueryResult {
  const exceptions = new Set<string>();
  let elemhide = false;
  let generichide = false;
  let specifichide = false;

  for (const b of bundles) {
    for (const s of b.genericExceptions) exceptions.add(s);
    for (const k of keys) {
      for (const s of b.exceptions[k] ?? []) exceptions.add(s);
    }
    if (!elemhide && keys.some((k) => b.elemhide.includes(k))) elemhide = true;
    if (!generichide && keys.some((k) => b.generichide.includes(k))) generichide = true;
    if (!specifichide && keys.some((k) => b.specifichide.includes(k))) specifichide = true;
  }

  if (elemhide) return { selectors: [], procedural: [], generic: false, exceptions };

  const selectors = new Set<string>();
  const procedural = new Set<string>();
  for (const b of bundles) {
    if (!specifichide) {
      for (const k of keys) {
        for (const s of b.specific[k] ?? []) if (!exceptions.has(s)) selectors.add(s);
        for (const s of b.procedural[k] ?? []) if (!exceptions.has(s)) procedural.add(s);
      }
    }
    if (!generichide) {
      for (const s of b.high) if (!exceptions.has(s)) selectors.add(s);
    }
  }
  return { selectors: [...selectors], procedural: [...procedural], generic: !generichide, exceptions };
}

export function queryLowlyGeneric(
  bundles: readonly CosmeticBundle[],
  tokens: readonly string[],
  exceptions: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const b of bundles) {
    for (const t of tokens) {
      for (const s of b.lowly[t] ?? []) if (!exceptions.has(s)) out.add(s);
    }
  }
  return [...out];
}

/* -------------------------------------------------------------------------- */
/* CSS generation                                                               */
/* -------------------------------------------------------------------------- */

const STYLE_RE = /^(.+?):style\((.*)\)$/;

/**
 * Builds a stylesheet, one rule per selector. Using one rule per selector is
 * deliberate: an invalid selector in a selector list invalidates the whole
 * list, whereas an invalid standalone rule is skipped by the CSS parser.
 */
export function buildCss(selectors: Iterable<string>, hideDeclaration = 'display:none!important'): string {
  const out: string[] = [];
  for (const sel of selectors) {
    const m = STYLE_RE.exec(sel);
    if (m) {
      const decls = (m[2] ?? '')
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d !== '' && !/url\s*\(/i.test(d) && !d.includes('{') && !d.includes('}'))
        .map((d) => (/!important$/i.test(d) ? d : `${d} !important`));
      if (decls.length) out.push(`${m[1]}{${decls.join(';')}}`);
    } else {
      out.push(`${sel}{${hideDeclaration}}`);
    }
  }
  return out.join('\n');
}
