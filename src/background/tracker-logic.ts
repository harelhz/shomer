/**
 * Tracker learning — the Privacy Badger-style heuristic, as pure functions.
 *
 * A third-party domain is considered tracking on a site when it does
 * something that can identify you across sites: it sends or sets a cookie
 * with an identifier-like value, or one of its scripts fingerprints the
 * browser. Once a domain has been seen tracking on `threshold` different
 * sites, it is blocked (or cookie-blocked, if blocking it would break sites).
 *
 * No list of trackers is needed: this catches trackers no list knows about.
 */
import type { PublicSuffixList } from '../shared/psl';
import type { TrackerAction } from '../shared/settings';
import { MDFP_GROUPS, MDFP_PREFIXES, YELLOWLIST } from '../data/trackers';

export type TrackingSignal = 'cookie' | 'fingerprint';

export interface TrackerRecord {
  /** First-party sites the tracker was seen tracking on (capped). */
  sites: string[];
  firstSeen: number;
  lastSeen: number;
  signals: Partial<Record<TrackingSignal, number>>;
}

export type TrackerDb = Record<string, TrackerRecord>;

export const MAX_SITES_PER_TRACKER = 20;
export const MAX_TRACKERS = 10_000;

/* -------------------------------------------------------------------------- */
/* Cookie entropy                                                               */
/* -------------------------------------------------------------------------- */

const LOW_ENTROPY_VALUES = new Set([
  '',
  'true',
  'false',
  'yes',
  'no',
  'on',
  'off',
  'null',
  'undefined',
  'none',
  'accept',
  'accepted',
  'reject',
  'rejected',
  'deny',
  'denied',
  'allow',
  'necessary',
  'enabled',
  'disabled',
]);

/**
 * Estimated entropy, in bits, of a cookie value: length × log2(alphabet),
 * where the alphabet is the union of character classes present.
 */
export function estimateEntropyBits(value: string): number {
  const v = value.trim();
  if (LOW_ENTROPY_VALUES.has(v.toLowerCase())) return 0;
  // Locales and short language tags (en, en-US, he_IL) carry little entropy.
  if (/^[a-z]{2}([-_][a-z]{2})?$/i.test(v)) return 0;
  let alphabet = 0;
  if (/[0-9]/.test(v)) alphabet += 10;
  if (/[a-z]/.test(v)) alphabet += 26;
  if (/[A-Z]/.test(v)) alphabet += 26;
  if (/[^0-9a-zA-Z]/.test(v)) alphabet += 16;
  if (alphabet === 0) return 0;
  return v.length * Math.log2(alphabet);
}

/** Roughly "could this uniquely identify a browser among millions?" */
export const IDENTIFIER_BITS = 40;

export function isIdentifyingValue(value: string): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* keep raw */
  }
  return estimateEntropyBits(decoded) >= IDENTIFIER_BITS;
}

/** `a=1; b=xyz` → ['1', 'xyz'] */
export function cookieHeaderValues(header: string): string[] {
  return header
    .split(';')
    .map((part) => {
      const eq = part.indexOf('=');
      return eq === -1 ? '' : part.slice(eq + 1).trim();
    })
    .filter((v) => v !== '');
}

/** `id=xyz; Path=/; Secure` → 'xyz' */
export function setCookieValue(header: string): string {
  const first = header.split(';', 1)[0] ?? '';
  const eq = first.indexOf('=');
  return eq === -1 ? '' : first.slice(eq + 1).trim();
}

export function hasIdentifyingCookie(cookieHeader: string): boolean {
  return cookieHeaderValues(cookieHeader).some(isIdentifyingValue);
}

/* -------------------------------------------------------------------------- */
/* Parties                                                                      */
/* -------------------------------------------------------------------------- */

const mdfpIndex = new Map<string, number>();
MDFP_GROUPS.forEach((group, i) => group.forEach((d) => mdfpIndex.set(d, i)));

function mdfpGroupIndex(base: string): number | undefined {
  const direct = mdfpIndex.get(base);
  if (direct !== undefined) return direct;
  for (const [prefix, member] of MDFP_PREFIXES) {
    if (base.startsWith(prefix)) return mdfpIndex.get(member);
  }
  return undefined;
}

/** The registrable domains run by the same organisation as `base`. */
export function mdfpGroupOf(base: string): readonly string[] | null {
  const i = mdfpGroupIndex(base);
  return i === undefined ? null : (MDFP_GROUPS[i] ?? null);
}

export function isSameParty(baseA: string, baseB: string): boolean {
  if (baseA === baseB) return true;
  const a = mdfpGroupIndex(baseA);
  return a !== undefined && a === mdfpGroupIndex(baseB);
}

export function isSubdomainOrSelf(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isYellowlisted(host: string, yellowlist: readonly string[] = YELLOWLIST): boolean {
  return yellowlist.some((y) => isSubdomainOrSelf(host, y));
}

/** Yellowlist entries that live under `base` (e.g. `www.google.com` under `google.com`). */
export function yellowlistedSubdomains(base: string, yellowlist: readonly string[] = YELLOWLIST): string[] {
  return yellowlist.filter((y) => y !== base && isSubdomainOrSelf(y, base));
}

/* -------------------------------------------------------------------------- */
/* Learning                                                                     */
/* -------------------------------------------------------------------------- */

export interface RecordResult {
  changed: boolean;
  /** The tracker just reached the blocking threshold. */
  crossedThreshold: boolean;
}

export function recordTracking(
  db: TrackerDb,
  trackerBase: string,
  site: string,
  signal: TrackingSignal,
  threshold: number,
  now = Date.now(),
): RecordResult {
  if (isSameParty(trackerBase, site)) return { changed: false, crossedThreshold: false };
  let record = db[trackerBase];
  if (!record) {
    record = { sites: [], firstSeen: now, lastSeen: now, signals: {} };
    db[trackerBase] = record;
  }
  record.lastSeen = now;
  record.signals[signal] = (record.signals[signal] ?? 0) + 1;
  if (record.sites.includes(site)) return { changed: true, crossedThreshold: false };
  const before = record.sites.length;
  if (before < MAX_SITES_PER_TRACKER) record.sites.push(site);
  return { changed: true, crossedThreshold: before < threshold && record.sites.length >= threshold };
}

export function learnedAction(
  base: string,
  record: TrackerRecord | undefined,
  threshold: number,
): TrackerAction | 'none' {
  if (!record || record.sites.length < threshold) return 'none';
  return isYellowlisted(base) ? 'cookieblock' : 'block';
}

/** Keeps the database bounded: drops the least recently seen low-signal records first. */
export function pruneDb(db: TrackerDb, threshold: number, max = MAX_TRACKERS): void {
  const entries = Object.entries(db);
  if (entries.length <= max) return;
  entries.sort(([, a], [, b]) => {
    const blockedA = a.sites.length >= threshold ? 1 : 0;
    const blockedB = b.sites.length >= threshold ? 1 : 0;
    return blockedA - blockedB || a.lastSeen - b.lastSeen;
  });
  for (const [domain] of entries.slice(0, entries.length - max)) delete db[domain];
}

/** Validates an imported tracker database. */
export function sanitizeTrackerDb(input: unknown): TrackerDb {
  const db: TrackerDb = {};
  if (typeof input !== 'object' || input === null) return db;
  for (const [domain, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-z0-9.-]+$/.test(domain) || typeof raw !== 'object' || raw === null) continue;
    const r = raw as Partial<TrackerRecord>;
    const sites = Array.isArray(r.sites)
      ? r.sites.filter((s): s is string => typeof s === 'string' && /^[a-z0-9.-]+$/.test(s))
      : [];
    db[domain] = {
      sites: [...new Set(sites)].slice(0, MAX_SITES_PER_TRACKER),
      firstSeen: Number(r.firstSeen) || Date.now(),
      lastSeen: Number(r.lastSeen) || Date.now(),
      signals: {
        cookie: Number(r.signals?.cookie) || 0,
        fingerprint: Number(r.signals?.fingerprint) || 0,
      },
    };
  }
  return db;
}

export function siteOf(psl: PublicSuffixList, hostname: string): string {
  return psl.getDomain(hostname);
}
