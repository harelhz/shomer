/**
 * User settings: schema, defaults and validation.
 *
 * `sanitizeSettings` is the single gate for anything that becomes a Settings
 * object — storage on startup, dashboard updates and backup imports — so
 * malformed or hostile input (e.g. a tampered backup file) can't put the
 * extension into an invalid state.
 */
import { DEFAULT_LEARNING_THRESHOLD, MODULE_IDS, RULESETS, type ModuleId } from './constants';

export type TrackerAction = 'allow' | 'cookieblock' | 'block';
export type FingerprintLevel = 'standard' | 'strict';
export type CookieMode = 'reject' | 'hide';

export interface Settings {
  schemaVersion: 1;
  /** Global on/off for each protection module. */
  modules: Record<ModuleId, boolean>;
  /** Static ruleset id → enabled. */
  rulesets: Record<string, boolean>;
  fingerprintLevel: FingerprintLevel;
  cookieMode: CookieMode;
  /** Learn new trackers locally from browsing (Privacy Badger-style). */
  learning: boolean;
  learningThreshold: number;
  /** Keep WebRTC from exposing local IP addresses. */
  webrtcProtection: boolean;
  /** Show the number of blocked requests on the toolbar icon. */
  badge: boolean;
  /** Sites (registrable domains) where Shomer is fully disabled. */
  allowlist: string[];
  /** Per-site module overrides: site → module → enabled. */
  siteModules: Record<string, Partial<Record<ModuleId, boolean>>>;
  /** Explicit choices for third-party domains, overriding learning and lists. */
  trackerOverrides: Record<string, TrackerAction>;
  /** "My filters", in ABP / uBO syntax. */
  customFilters: string;
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    modules: { adblock: true, trackers: true, fingerprint: true, cookies: true },
    rulesets: Object.fromEntries(RULESETS.map((r) => [r.id, r.defaultEnabled])),
    fingerprintLevel: 'standard',
    cookieMode: 'reject',
    learning: true,
    learningThreshold: DEFAULT_LEARNING_THRESHOLD,
    webrtcProtection: true,
    badge: true,
    allowlist: [],
    siteModules: {},
    trackerOverrides: {},
    customFilters: '',
  };
}

const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/;

export function isValidDomain(value: unknown): value is string {
  return typeof value === 'string' && DOMAIN_RE.test(value);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

const MAX_CUSTOM_FILTERS_LENGTH = 1_000_000;

export function sanitizeSettings(input: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(input)) return d;

  const modules = { ...d.modules };
  if (isRecord(input.modules)) {
    for (const m of MODULE_IDS) modules[m] = bool(input.modules[m], d.modules[m]);
  }

  const rulesets = { ...d.rulesets };
  if (isRecord(input.rulesets)) {
    for (const id of Object.keys(rulesets)) rulesets[id] = bool(input.rulesets[id], rulesets[id] ?? false);
  }

  const allowlist = Array.isArray(input.allowlist)
    ? [...new Set(input.allowlist.filter(isValidDomain))].sort()
    : d.allowlist;

  const siteModules: Settings['siteModules'] = {};
  if (isRecord(input.siteModules)) {
    for (const [site, overrides] of Object.entries(input.siteModules)) {
      if (!isValidDomain(site) || !isRecord(overrides)) continue;
      const clean: Partial<Record<ModuleId, boolean>> = {};
      for (const m of MODULE_IDS) if (typeof overrides[m] === 'boolean') clean[m] = overrides[m];
      if (Object.keys(clean).length > 0) siteModules[site] = clean;
    }
  }

  const trackerOverrides: Settings['trackerOverrides'] = {};
  if (isRecord(input.trackerOverrides)) {
    for (const [domain, action] of Object.entries(input.trackerOverrides)) {
      if (isValidDomain(domain) && (action === 'allow' || action === 'cookieblock' || action === 'block')) {
        trackerOverrides[domain] = action;
      }
    }
  }

  const threshold = Number(input.learningThreshold);

  return {
    schemaVersion: 1,
    modules,
    rulesets,
    fingerprintLevel: input.fingerprintLevel === 'strict' ? 'strict' : 'standard',
    cookieMode: input.cookieMode === 'hide' ? 'hide' : 'reject',
    learning: bool(input.learning, d.learning),
    learningThreshold:
      Number.isInteger(threshold) && threshold >= 2 && threshold <= 10 ? threshold : d.learningThreshold,
    webrtcProtection: bool(input.webrtcProtection, d.webrtcProtection),
    badge: bool(input.badge, d.badge),
    allowlist,
    siteModules,
    trackerOverrides,
    customFilters:
      typeof input.customFilters === 'string'
        ? input.customFilters.slice(0, MAX_CUSTOM_FILTERS_LENGTH)
        : d.customFilters,
  };
}

/** Is `module` active on `site`, taking the allowlist and overrides into account? */
export function isModuleActive(settings: Settings, site: string, module: ModuleId): boolean {
  if (!settings.modules[module]) return false;
  if (settings.allowlist.includes(site)) return false;
  return settings.siteModules[site]?.[module] !== false;
}

/** Sites where `module` has been switched off explicitly (or that are allowlisted). */
export function sitesWithModuleOff(settings: Settings, module: ModuleId): string[] {
  const sites = new Set(settings.allowlist);
  for (const [site, overrides] of Object.entries(settings.siteModules)) {
    if (overrides[module] === false) sites.add(site);
  }
  return [...sites].sort();
}

/** Static rulesets that should currently be enabled. */
export function enabledRulesetIds(settings: Settings): string[] {
  return RULESETS.filter((r) => {
    if (!settings.rulesets[r.id]) return false;
    return r.module === 'privacy' || settings.modules[r.module];
  }).map((r) => r.id);
}
