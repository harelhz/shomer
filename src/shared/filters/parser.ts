/**
 * Parser for Adblock Plus / uBlock Origin filter syntax.
 *
 * Turns one line of a filter list into a typed AST. The parser is shared by the
 * build-time list compiler (Node) and the runtime "My filters" compiler (the
 * extension), so it must not depend on any browser or Node API.
 *
 * Reference: https://help.adblockplus.org/hc/en-us/articles/360062733293
 *            https://github.com/gorhill/uBlock/wiki/Static-filter-syntax
 */
import type { RequestMethod, ResourceType } from '../dnr-types';
import { toAscii } from '../psl';

export interface DomainList {
  include: string[];
  exclude: string[];
}

export type NetworkTypeToken = ResourceType | 'document' | 'popup' | 'all';

export interface NetworkFilter {
  kind: 'network';
  raw: string;
  exception: boolean;
  /** The URL pattern, without the `@@` prefix and `$options` suffix. */
  pattern: string;
  /** Set when the pattern is a `/regular expression/`. */
  regex: string | null;
  types: NetworkTypeToken[] | null;
  excludedTypes: ResourceType[];
  party: 'first' | 'third' | null;
  domains: DomainList;
  to: DomainList;
  denyallow: string[];
  methods: RequestMethod[];
  excludedMethods: RequestMethod[];
  important: boolean;
  matchCase: boolean;
  badfilter: boolean;
  redirect: string | null;
  /** `redirect-rule=`: only redirect when blocked by another filter. */
  redirectRule: boolean;
  /** `''` means "remove the whole query string". */
  removeparam: string | null;
  elemhide: boolean;
  generichide: boolean;
  specifichide: boolean;
  genericblock: boolean;
}

export interface CosmeticFilter {
  kind: 'cosmetic';
  raw: string;
  domains: DomainList;
  selector: string;
  exception: boolean;
  /** Needs the content-script engine (`:has-text()`, `:upward()`, `:remove()`…). */
  procedural: boolean;
}

export interface ScriptletFilter {
  kind: 'scriptlet';
  raw: string;
  domains: DomainList;
  exception: boolean;
  /** Empty for `#@#+js()`, which disables every scriptlet on the domains. */
  name: string;
  args: string[];
}

export interface HostsEntry {
  kind: 'hosts';
  raw: string;
  domain: string;
}

export interface UnsupportedFilter {
  kind: 'unsupported';
  raw: string;
  reason: string;
}

export type ParsedFilter = NetworkFilter | CosmeticFilter | ScriptletFilter | HostsEntry | UnsupportedFilter;

export interface ParseOptions {
  /** `hosts` lists contain `0.0.0.0 example.com` lines instead of ABP filters. */
  format?: 'abp' | 'hosts';
}

const COSMETIC_RE = /^([^#]*?)(#@?[?$%]{0,2}#)(.*)$/;
const COSMETIC_DOMAINS_RE = /^[\p{L}\p{N}.,~*_-]*$/u;
const HOSTS_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|0)\s+([^\s#]+)/;
const PLAIN_HOSTNAME_RE = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$/i;
const IGNORED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  '0.0.0.0',
  'ip6-localhost',
  'ip6-loopback',
]);

/**
 * Procedural operators that need the content-script engine. Native CSS `:has()`
 * and `:not()` are supported by every browser we target, so they only count as
 * procedural when they wrap one of these.
 */
export const PROCEDURAL_OPERATORS = [
  ':has-text(',
  ':-abp-contains(',
  ':contains(',
  ':-abp-has(',
  ':upward(',
  ':matches-css(',
  ':matches-css-before(',
  ':matches-css-after(',
  ':min-text-length(',
  ':matches-path(',
  ':matches-attr(',
  ':matches-prop(',
  ':xpath(',
  ':remove()',
  ':remove-attr(',
  ':remove-class(',
  ':watch-attr(',
  ':others(',
] as const;

export function isProceduralSelector(selector: string): boolean {
  return PROCEDURAL_OPERATORS.some((op) => selector.includes(op));
}

export function parseFilter(line: string, options: ParseOptions = {}): ParsedFilter | null {
  const raw = line.trim();
  if (raw === '' || raw.startsWith('!') || raw.startsWith('[')) return null;

  if (options.format === 'hosts') return parseHostsLine(raw);
  // `# comment` is only a comment in hosts files, but some ABP lists contain them too.
  if (/^#(\s|$)/.test(raw)) return null;

  const cosmetic = COSMETIC_RE.exec(raw);
  if (cosmetic) {
    const [, domainPart = '', separator = '', body = ''] = cosmetic;
    if (COSMETIC_DOMAINS_RE.test(domainPart)) return parseCosmetic(raw, domainPart, separator, body);
    if (domainPart.startsWith('[$')) return unsupported(raw, 'adguard-modifiers');
  }

  return parseNetwork(raw);
}

function unsupported(raw: string, reason: string): UnsupportedFilter {
  return { kind: 'unsupported', raw, reason };
}

/* -------------------------------------------------------------------------- */
/* Hosts files                                                                 */
/* -------------------------------------------------------------------------- */

function parseHostsLine(raw: string): ParsedFilter | null {
  if (raw.startsWith('#')) return null;
  const m = HOSTS_RE.exec(raw);
  const host = (m ? m[1] : raw.split(/\s/, 1)[0])?.toLowerCase() ?? '';
  if (IGNORED_HOSTS.has(host)) return null;
  if (!PLAIN_HOSTNAME_RE.test(host)) return unsupported(raw, 'hosts-invalid');
  return { kind: 'hosts', raw, domain: host };
}

/* -------------------------------------------------------------------------- */
/* Cosmetic filters                                                            */
/* -------------------------------------------------------------------------- */

export function parseDomainList(text: string, separator: string): DomainList | null {
  const include: string[] = [];
  const exclude: string[] = [];
  for (let entry of text.split(separator)) {
    entry = entry.trim();
    if (entry === '') continue;
    const negated = entry.startsWith('~');
    if (negated) entry = entry.slice(1);
    // Regex domains (uBO) are not representable anywhere downstream.
    if (entry.startsWith('/')) return null;
    const domain = toAscii(entry.toLowerCase());
    (negated ? exclude : include).push(domain);
  }
  return { include, exclude };
}

function parseCosmetic(raw: string, domainPart: string, separator: string, body: string): ParsedFilter {
  const exception = separator.includes('@');
  const domains = parseDomainList(domainPart, ',');
  if (domains === null) return unsupported(raw, 'regex-domain');
  const hasDomains = domains.include.length > 0;

  if (separator.includes('%')) return unsupported(raw, 'adguard-js');
  if (body === '') return unsupported(raw, 'empty-selector');

  // uBO scriptlet injection: example.com##+js(name, arg1, arg2)
  if (body.startsWith('+js(')) {
    if (!body.endsWith(')')) return unsupported(raw, 'scriptlet-syntax');
    const inner = body.slice(4, -1).trim();
    const [name = '', ...args] = inner === '' ? [] : splitScriptletArgs(inner);
    if (name === '' && !exception) return unsupported(raw, 'scriptlet-syntax');
    if (!hasDomains && !exception) return unsupported(raw, 'generic-scriptlet');
    return { kind: 'scriptlet', raw, domains, exception, name, args };
  }

  if (body.startsWith('^')) return unsupported(raw, 'html-filtering');

  let selector = body.trim();
  // CSS injection: `selector { declarations }`, either with the AdGuard `#$#`
  // separator or inline. In ABP `#$#` means "snippet", which we don't support.
  const styleMatch = /^(.+?)\s*\{([^{}]*)\}$/.exec(selector);
  if (styleMatch) {
    selector = `${styleMatch[1]}:style(${styleMatch[2]?.trim()})`;
  } else if (separator.includes('$')) {
    return unsupported(raw, 'abp-snippet');
  }

  if (selector.includes(':-abp-properties(')) return unsupported(raw, 'abp-properties');
  if (!isSafeSelector(selector)) return unsupported(raw, 'unsafe-selector');

  const procedural = isProceduralSelector(selector);
  if ((procedural || selector.includes(':style(')) && !hasDomains && !exception) {
    return unsupported(raw, 'generic-procedural');
  }

  return { kind: 'cosmetic', raw, domains, selector, exception, procedural };
}

/**
 * Rejects selectors that could escape the `selector { … }` rule we wrap them in
 * when injecting a stylesheet. A filter list must never be able to inject
 * arbitrary CSS (e.g. `body { background: url(https://tracker/) }`).
 */
export function isSafeSelector(selector: string): boolean {
  if (selector.includes('{') || selector.includes('}')) return false;
  if (selector.includes('\\') && /\\[{}]/.test(selector)) return false;
  if (/\/\*|\*\//.test(selector)) return false;
  let depthParen = 0;
  let depthBracket = 0;
  let quote: string | null = null;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depthParen++;
    else if (c === ')') depthParen--;
    else if (c === '[') depthBracket++;
    else if (c === ']') depthBracket--;
    if (depthParen < 0 || depthBracket < 0) return false;
  }
  return quote === null && depthParen === 0 && depthBracket === 0;
}

/**
 * Splits scriptlet arguments on unescaped commas, trimming whitespace and
 * stripping one level of matching quotes, as uBO does.
 */
export function splitScriptletArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === ',') {
      current += ',';
      i++;
    } else if (c === ',') {
      args.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  args.push(current);
  return args.map((a) => {
    const t = a.trim();
    if (t.length >= 2 && (t[0] === '"' || t[0] === "'" || t[0] === '`') && t[t.length - 1] === t[0]) {
      return t.slice(1, -1);
    }
    return t;
  });
}

/* -------------------------------------------------------------------------- */
/* Network filters                                                             */
/* -------------------------------------------------------------------------- */

const TYPE_OPTIONS: Record<string, NetworkTypeToken> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  'object-subrequest': 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  websocket: 'websocket',
  media: 'media',
  font: 'font',
  other: 'other',
  document: 'document',
  doc: 'document',
  popup: 'popup',
  all: 'all',
};

const METHODS = new Set<RequestMethod>(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put']);

/** Options we recognise but cannot express in declarativeNetRequest. */
const UNSUPPORTED_OPTIONS = new Set([
  'csp',
  'header',
  'permissions',
  'inline-script',
  'inline-font',
  'popunder',
  'cname',
  'urlskip',
  'replace',
  'uritransform',
  'urltransform',
  'ipaddress',
  'webrtc',
  'stealth',
  'content',
  'extension',
  'jsinject',
  'urlblock',
  'network',
  'app',
  'cookie',
  'hls',
  'jsonprune',
  'xmlprune',
  'referrerpolicy',
]);

const IGNORED_OPTIONS = new Set(['_', 'reason', 'strict-first-party', 'strict-third-party']);

const OPTION_TOKEN_RE = /^~?[a-z0-9_-]+(=.*)?$/i;

/**
 * Finds the `$` that starts the options. The pattern itself may contain `$`
 * (notably regex anchors), so we take the last `$` whose remainder parses as
 * an option list.
 */
function findOptionsStart(text: string): number {
  // Note that a filter may consist of options only, e.g. `$script,domain=example.com`.
  let i = text.lastIndexOf('$');
  while (i >= 0) {
    const rest = text.slice(i + 1);
    if (rest !== '' && rest.split(',').every((t) => OPTION_TOKEN_RE.test(t.trim()))) return i;
    if (i === 0) break;
    i = text.lastIndexOf('$', i - 1);
  }
  return -1;
}

function parseNetwork(raw: string): ParsedFilter {
  let text = raw;
  const exception = text.startsWith('@@');
  if (exception) text = text.slice(2);

  const filter: NetworkFilter = {
    kind: 'network',
    raw,
    exception,
    pattern: text,
    regex: null,
    types: null,
    excludedTypes: [],
    party: null,
    domains: { include: [], exclude: [] },
    to: { include: [], exclude: [] },
    denyallow: [],
    methods: [],
    excludedMethods: [],
    important: false,
    matchCase: false,
    badfilter: false,
    redirect: null,
    redirectRule: false,
    removeparam: null,
    elemhide: false,
    generichide: false,
    specifichide: false,
    genericblock: false,
  };

  const optionsStart = findOptionsStart(text);
  if (optionsStart !== -1) {
    filter.pattern = text.slice(0, optionsStart);
    const error = parseNetworkOptions(text.slice(optionsStart + 1), filter);
    if (error) return unsupported(raw, error);
  }

  const p = filter.pattern;
  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
    filter.regex = p.slice(1, -1);
  }

  if (filter.types) {
    const meaningful = filter.types.filter((t) => t !== 'popup');
    if (meaningful.length === 0) return unsupported(raw, 'popup');
  }

  const cosmeticOnly = filter.elemhide || filter.generichide || filter.specifichide;
  if (cosmeticOnly && !exception) return unsupported(raw, 'cosmetic-option-on-block');

  return filter;
}

/** Returns an "unsupported" reason, or null on success. */
function parseNetworkOptions(optionText: string, f: NetworkFilter): string | null {
  for (const token of optionText.split(',')) {
    let option = token.trim();
    if (option === '') continue;
    const negated = option.startsWith('~');
    if (negated) option = option.slice(1);
    const eq = option.indexOf('=');
    const name = (eq === -1 ? option : option.slice(0, eq)).toLowerCase();
    const value = eq === -1 ? '' : option.slice(eq + 1);

    const type = TYPE_OPTIONS[name];
    if (type !== undefined) {
      if (negated) {
        if (type === 'all' || type === 'popup' || type === 'document') continue;
        f.excludedTypes.push(type);
      } else {
        (f.types ??= []).push(type);
      }
      continue;
    }

    switch (name) {
      case 'third-party':
      case '3p':
      case 'strict3p':
        f.party = negated ? 'first' : 'third';
        break;
      case 'first-party':
      case '1p':
      case 'strict1p':
        f.party = negated ? 'third' : 'first';
        break;
      case 'domain':
      case 'from': {
        const list = parseDomainList(value, '|');
        if (!list) return 'regex-domain';
        f.domains = list;
        break;
      }
      case 'to': {
        const list = parseDomainList(value, '|');
        if (!list) return 'regex-domain';
        f.to = list;
        break;
      }
      case 'denyallow':
        f.denyallow = value
          .split('|')
          .filter(Boolean)
          .map((d) => toAscii(d.toLowerCase()));
        break;
      case 'method':
        for (let m of value.toLowerCase().split('|')) {
          const neg = m.startsWith('~');
          if (neg) m = m.slice(1);
          if (!METHODS.has(m as RequestMethod)) return 'method';
          (neg ? f.excludedMethods : f.methods).push(m as RequestMethod);
        }
        break;
      case 'important':
        f.important = true;
        break;
      case 'match-case':
        f.matchCase = true;
        break;
      case 'badfilter':
        f.badfilter = true;
        break;
      case 'redirect':
      case 'redirect-rule':
        // uBO allows `redirect=token:priority`
        f.redirect = value.replace(/:\d+$/, '');
        f.redirectRule = name === 'redirect-rule';
        break;
      case 'rewrite':
        if (!value.startsWith('abp-resource:')) return 'rewrite';
        f.redirect = value.slice('abp-resource:'.length);
        break;
      case 'empty':
        f.redirect = 'empty';
        break;
      case 'mp4':
        f.redirect = 'noopmp4-1s';
        break;
      case 'removeparam':
      case 'queryprune':
        if (negated) return 'removeparam-negated';
        f.removeparam = value;
        break;
      case 'elemhide':
      case 'ehide':
        f.elemhide = true;
        break;
      case 'generichide':
      case 'ghide':
        f.generichide = true;
        break;
      case 'specifichide':
      case 'shide':
        f.specifichide = true;
        break;
      case 'genericblock':
        f.genericblock = true;
        break;
      default:
        if (IGNORED_OPTIONS.has(name) || name.startsWith('_')) break;
        if (UNSUPPORTED_OPTIONS.has(name)) return `option:${name}`;
        return `unknown-option:${name}`;
    }
  }
  return null;
}

/**
 * Canonical text of a filter with `$badfilter` removed, used to match a
 * `$badfilter` line with the filter it cancels.
 */
export function badfilterKey(raw: string): string {
  const optionsStart = findOptionsStart(raw);
  if (optionsStart === -1) return raw;
  const options = raw
    .slice(optionsStart + 1)
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '' && o.toLowerCase() !== 'badfilter')
    .sort();
  const pattern = raw.slice(0, optionsStart);
  return options.length ? `${pattern}$${options.join(',')}` : pattern;
}
