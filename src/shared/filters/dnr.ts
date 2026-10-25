/**
 * Compiles parsed network filters into declarativeNetRequest rules.
 *
 * Manifest V3 extensions cannot run their own matching engine on the network
 * path; the browser does the matching. So instead of shipping uBO's engine we
 * translate each filter into the browser's rule format, and report the ones
 * that cannot be expressed instead of silently dropping them.
 */
import {
  ALL_RESOURCE_TYPES,
  type DnrCondition,
  type DnrRule,
  type DnrRuleDraft,
  type ResourceType,
} from '../dnr-types';
import { PRIORITY } from '../constants';
import { toAscii } from '../psl';
import type { HostsEntry, NetworkFilter, NetworkTypeToken } from './parser';
import { resolveRedirectResource } from './resources';

export type ConvertResult =
  | { ok: true; rule: DnrRuleDraft }
  | { ok: false; reason: string }
  /** The filter only affects cosmetic filtering (e.g. `@@||x.com^$generichide`). */
  | { ok: 'cosmetic' };

export interface ConvertOptions {
  /** Added to every priority; used to lift "My filters" above the lists. */
  priorityOffset?: number;
}

const DOMAIN_RE = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/;
const PURE_DOMAIN_PATTERN_RE = /^\|\|([a-z0-9_.-]+)\^?\|?$/i;
const DEFAULT_REMOVEPARAM_TYPES: ResourceType[] = ['main_frame', 'sub_frame', 'xmlhttprequest'];

function normalizeDomain(d: string): string | null {
  const ascii = toAscii(d.toLowerCase()).replace(/\.$/, '');
  return DOMAIN_RE.test(ascii) ? ascii : null;
}

/**
 * Normalises a list of domains. Entities (`example.*`) cannot be expressed in
 * DNR and are dropped; the caller decides whether that makes the filter unsafe.
 */
function normalizeDomains(list: string[]): { domains: string[]; dropped: number } {
  const out = new Set<string>();
  let dropped = 0;
  for (const d of list) {
    const n = normalizeDomain(d);
    if (n) out.add(n);
    else dropped++;
  }
  return { domains: [...out], dropped };
}

/**
 * RE2 (used by Chrome's DNR) does not support look-around or backreferences.
 * Long expressions risk exceeding the per-rule memory budget.
 */
export function isRe2Compatible(source: string): boolean {
  if (source.length > 250) return false;

  if (!/^[\x20-\x7e]*$/.test(source)) return false;
  if (/\(\?[=!<]|\(\?<[=!]|\\[1-9]|\(\?>|[*+?}]\+/.test(source)) return false;
  try {
    new RegExp(source);
  } catch {
    return false;
  }
  return true;
}

function priorityFor(f: NetworkFilter, kind: 'block' | 'redirect' | 'allow', offset: number): number {
  const ladder = f.important
    ? {
        block: PRIORITY.LIST_IMPORTANT_BLOCK,
        redirect: PRIORITY.LIST_IMPORTANT_REDIRECT,
        allow: PRIORITY.LIST_IMPORTANT_ALLOW,
      }
    : { block: PRIORITY.LIST_BLOCK, redirect: PRIORITY.LIST_REDIRECT, allow: PRIORITY.LIST_ALLOW };
  return ladder[kind] + offset;
}

function expandTypes(tokens: NetworkTypeToken[]): ResourceType[] {
  const out = new Set<ResourceType>();
  for (const t of tokens) {
    if (t === 'all') ALL_RESOURCE_TYPES.forEach((x) => out.add(x));
    else if (t === 'document') out.add('main_frame');
    else if (t !== 'popup') out.add(t);
  }
  return [...out];
}

export function convertNetworkFilter(f: NetworkFilter, options: ConvertOptions = {}): ConvertResult {
  const offset = options.priorityOffset ?? 0;
  const isDocumentException = f.exception && f.types?.includes('document') === true;

  if (f.redirectRule) return { ok: false, reason: 'redirect-rule' };
  if (f.genericblock) return { ok: false, reason: 'genericblock' };
  if ((f.elemhide || f.generichide || f.specifichide) && !isDocumentException) {
    // Pure cosmetic exception; handled by the cosmetic compiler.
    return f.types === null ? { ok: 'cosmetic' } : { ok: false, reason: 'mixed-cosmetic-exception' };
  }
  if (f.exception && f.removeparam !== null) return { ok: false, reason: 'removeparam-exception' };

  const condition: DnrCondition = {};

  /* --- URL pattern ------------------------------------------------------ */
  if (f.regex !== null) {
    if (!isRe2Compatible(f.regex)) return { ok: false, reason: 'regex-unsupported' };
    condition.regexFilter = f.regex;
  } else {
    const pure = PURE_DOMAIN_PATTERN_RE.exec(f.pattern);
    const pureDomain = pure?.[1] ? normalizeDomain(pure[1]) : null;
    if (pureDomain && f.to.include.length === 0) {
      condition.requestDomains = [pureDomain];
    } else {
      let p = f.pattern;
      if (p.startsWith('||*')) p = p.slice(2);
      if (!p.startsWith('|')) p = p.replace(/^\*+/, '');
      if (!p.endsWith('|')) p = p.replace(/\*+$/, '');

      if (!/^[\x20-\x7e]*$/.test(p)) return { ok: false, reason: 'non-ascii-pattern' };
      if (p === '|' || p === '||') p = '';
      if (p !== '') condition.urlFilter = p;
    }
  }
  if (condition.urlFilter !== undefined || condition.regexFilter !== undefined) {
    condition.isUrlFilterCaseSensitive = f.matchCase;
  }

  /* --- Party / domains ---------------------------------------------------- */
  if (f.party === 'third') condition.domainType = 'thirdParty';
  else if (f.party === 'first') condition.domainType = 'firstParty';

  if (f.domains.include.length > 0) {
    const { domains } = normalizeDomains(f.domains.include);
    // If every domain was an entity we'd turn a site-specific filter into a
    // global one. Skip it instead.
    if (domains.length === 0) return { ok: false, reason: 'entity-domains' };
    condition.initiatorDomains = domains;
  }
  if (f.domains.exclude.length > 0) {
    const { domains } = normalizeDomains(f.domains.exclude);
    if (domains.length > 0) condition.excludedInitiatorDomains = domains;
  }
  if (f.to.include.length > 0) {
    const { domains } = normalizeDomains(f.to.include);
    if (domains.length === 0) return { ok: false, reason: 'entity-domains' };
    condition.requestDomains = [...(condition.requestDomains ?? []), ...domains];
  }
  const excludedRequest = [...f.to.exclude, ...f.denyallow];
  if (excludedRequest.length > 0) {
    const { domains } = normalizeDomains(excludedRequest);
    if (domains.length > 0) condition.excludedRequestDomains = domains;
  }

  /* --- Methods ------------------------------------------------------------ */
  if (f.methods.length > 0) condition.requestMethods = [...new Set(f.methods)];
  if (f.excludedMethods.length > 0) condition.excludedRequestMethods = [...new Set(f.excludedMethods)];

  /* --- Resource types ------------------------------------------------------ */
  if (f.types !== null) {
    const types = expandTypes(f.types).filter((t) => !f.excludedTypes.includes(t));
    if (types.length === 0) return { ok: false, reason: 'no-resource-types' };
    condition.resourceTypes = types;
  } else if (f.excludedTypes.length > 0) {
    // With only exclusions, DNR would also match main_frame; ABP never does.
    condition.excludedResourceTypes = [...new Set<ResourceType>([...f.excludedTypes, 'main_frame'])];
  }

  /* --- Action ---------------------------------------------------------------- */
  let rule: DnrRuleDraft;
  if (f.exception) {
    if (isDocumentException) {
      delete condition.excludedResourceTypes;
      condition.resourceTypes = ['main_frame', 'sub_frame'];
      rule = { priority: priorityFor(f, 'allow', offset), action: { type: 'allowAllRequests' }, condition };
    } else {
      rule = { priority: priorityFor(f, 'allow', offset), action: { type: 'allow' }, condition };
    }
  } else if (f.removeparam !== null) {
    const param = f.removeparam;
    if (param.startsWith('/') || param.includes('|') || param.includes('*')) {
      return { ok: false, reason: 'removeparam-regex' };
    }
    if (!condition.resourceTypes && !condition.excludedResourceTypes) {
      condition.resourceTypes = DEFAULT_REMOVEPARAM_TYPES;
    }
    const transform = param === '' ? { query: '' } : { queryTransform: { removeParams: [param] } };
    rule = {
      priority: priorityFor(f, 'redirect', offset),
      action: { type: 'redirect', redirect: { transform } },
      condition,
    };
  } else if (f.redirect !== null) {
    const path = resolveRedirectResource(f.redirect);
    rule = path
      ? {
          priority: priorityFor(f, 'redirect', offset),
          action: { type: 'redirect', redirect: { extensionPath: path } },
          condition,
        }
      : { priority: priorityFor(f, 'block', offset), action: { type: 'block' }, condition };
  } else {
    rule = { priority: priorityFor(f, 'block', offset), action: { type: 'block' }, condition };
  }

  /* --- Safety: refuse rules that would match (almost) everything ------------- */
  // (`*$ping,third-party` is fine: it is narrowed by resource type.)
  const narrowed =
    condition.urlFilter !== undefined ||
    condition.regexFilter !== undefined ||
    condition.requestDomains !== undefined ||
    condition.initiatorDomains !== undefined ||
    condition.resourceTypes !== undefined;
  if (!narrowed) return { ok: false, reason: 'too-broad' };

  return { ok: true, rule };
}

export function convertHostsEntry(entry: HostsEntry, options: ConvertOptions = {}): ConvertResult {
  const domain = normalizeDomain(entry.domain);
  if (!domain) return { ok: false, reason: 'hosts-invalid' };
  return {
    ok: true,
    rule: {
      priority: PRIORITY.LIST_BLOCK + (options.priorityOffset ?? 0),
      action: { type: 'block' },
      condition: { requestDomains: [domain] },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Rule set optimisation                                                       */
/* -------------------------------------------------------------------------- */

function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

/**
 * Removes domains that are already covered by a parent domain in the same
 * list: `requestDomains` matches subdomains, so `a.example.com` is redundant
 * next to `example.com`.
 */
export function pruneSubdomains(domains: Iterable<string>): string[] {
  const set = new Set(domains);
  const out: string[] = [];
  for (const d of set) {
    let covered = false;
    let dot = d.indexOf('.');
    while (dot !== -1) {
      if (set.has(d.slice(dot + 1))) {
        covered = true;
        break;
      }
      dot = d.indexOf('.', dot + 1);
    }
    if (!covered) out.push(d);
  }
  return out.sort();
}

const MAX_DOMAINS_PER_RULE = 2500;

/**
 * Deduplicates rules and merges rules that differ only in `requestDomains`
 * (or only in `initiatorDomains`) into a single rule. On EasyList +
 * EasyPrivacy this shrinks tens of thousands of `||domain^` filters into a
 * handful of rules, which matters because static rule quotas are shared
 * between all extensions in a profile.
 */
export function optimizeRules(drafts: DnrRuleDraft[]): DnrRuleDraft[] {
  return mergeOn(mergeOn(drafts, 'requestDomains'), 'initiatorDomains');
}

/**
 * Merging is sound because both fields are "any of" lists ANDed with the rest
 * of the condition: (rest ∧ D1) ∨ (rest ∧ D2) ≡ rest ∧ (D1 ∨ D2). Exclusion
 * lists don't have that property, which is why they're part of the key.
 */
function mergeOn(drafts: DnrRuleDraft[], field: 'requestDomains' | 'initiatorDomains'): DnrRuleDraft[] {
  const groups = new Map<string, { base: DnrRuleDraft; domains: Set<string> }>();
  const passthrough = new Map<string, DnrRuleDraft>();

  for (const rule of drafts) {
    const list = rule.condition[field];
    if (list === undefined) {
      passthrough.set(stableKey(rule), rule);
      continue;
    }
    const { [field]: _omit, ...rest } = rule.condition;
    const key = stableKey({ ...rule, condition: rest });
    let group = groups.get(key);
    if (!group) {
      group = { base: { ...rule, condition: rest }, domains: new Set() };
      groups.set(key, group);
    }
    for (const d of list) group.domains.add(d);
  }

  const out = [...passthrough.values()];
  for (const { base, domains } of groups.values()) {
    const list = field === 'requestDomains' ? pruneSubdomains(domains) : [...domains].sort();
    for (let i = 0; i < list.length; i += MAX_DOMAINS_PER_RULE) {
      out.push({ ...base, condition: { ...base.condition, [field]: list.slice(i, i + MAX_DOMAINS_PER_RULE) } });
    }
  }
  return out;
}

export function assignIds(drafts: DnrRuleDraft[], firstId = 1): DnrRule[] {
  return drafts.map((d, i) => ({ id: firstId + i, ...d }));
}
