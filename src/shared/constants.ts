/**
 * Rule priorities.
 *
 * declarativeNetRequest resolves conflicts by priority first, so the whole
 * precedence model of Shomer is encoded here. Higher wins.
 *
 * Within a source (filter lists, user filters) the classic ABP semantics are
 * preserved: block < redirect < exception < $important block < ... and an
 * `@@...$important` exception beats everything from the same source.
 */
export const PRIORITY = {
  /* Bundled filter lists (static rulesets). */
  LIST_BLOCK: 1,
  LIST_REDIRECT: 2,
  LIST_ALLOW: 3,
  LIST_IMPORTANT_BLOCK: 4,
  LIST_IMPORTANT_REDIRECT: 5,
  LIST_IMPORTANT_ALLOW: 6,

  /* "Ad blocking: off" for one site — overrides the lists but nothing else. */
  SITE_DISABLE_LISTS: 7,

  /* Trackers learned by the heuristic engine. */
  LEARNED_BLOCK: 8,
  LEARNED_YELLOW_ALLOW: 9,
  LEARNED_COOKIEBLOCK: 10,

  /*
   * Explicit per-domain choices made in the popup or dashboard. Their priority
   * grows with the number of labels in the domain so that a choice on
   * `cdn.example.com` beats a choice on `example.com`.
   * Final priority = USER_DOMAIN_BASE + labels * 4 + offset.
   */
  USER_DOMAIN_BASE: 20,

  /* "My filters" — same ladder as the lists, shifted up. */
  CUSTOM_OFFSET: 100,

  /* GPC / DNT request headers. Only a full site allowlist disables them. */
  PRIVACY_HEADERS: 500,

  /* Site fully trusted by the user: nothing applies. */
  SITE_ALLOWLIST: 1000,
} as const;

export const USER_DOMAIN_OFFSET = {
  allow: 0,
  cookieblockAllow: 1,
  cookieblockStrip: 2,
  block: 3,
} as const;

export type ModuleId = 'adblock' | 'trackers' | 'fingerprint' | 'cookies';
export const MODULE_IDS: readonly ModuleId[] = ['adblock', 'trackers', 'fingerprint', 'cookies'];

/**
 * Static rulesets. Third-party lists are downloaded and compiled at build time
 * (see scripts/compile-lists.ts); `generated` rulesets are produced from data
 * in this repository.
 */
export interface RulesetMeta {
  id: string;
  name: string;
  description: string;
  /** Which module owns the ruleset; toggling the module toggles it. */
  module: ModuleId | 'privacy';
  defaultEnabled: boolean;
  homepage?: string;
  license?: string;
}

export const RULESETS: readonly RulesetMeta[] = [
  {
    id: 'shomer-base',
    name: 'Shomer base filters',
    description: 'Shomer’s own filters: high-confidence ad and tracker domains, plus fixes.',
    module: 'adblock',
    defaultEnabled: true,
    license: 'GPL-3.0',
  },
  {
    id: 'easylist',
    name: 'EasyList',
    description: 'The primary filter list that removes most adverts from international webpages.',
    module: 'adblock',
    defaultEnabled: true,
    homepage: 'https://easylist.to/',
    license: 'GPL-3.0 / CC BY-SA 3.0',
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    description: 'Removes tracking scripts, analytics beacons and tracking pixels.',
    module: 'adblock',
    defaultEnabled: true,
    homepage: 'https://easylist.to/',
    license: 'GPL-3.0 / CC BY-SA 3.0',
  },
  {
    id: 'ublock-filters',
    name: 'uBlock filters',
    description: 'Filters maintained by the uBlock Origin team, including anti-adblock defusers.',
    module: 'adblock',
    defaultEnabled: true,
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
  },
  {
    id: 'ublock-privacy',
    name: 'uBlock filters – Privacy',
    description: 'Extra privacy filters from the uBlock Origin team.',
    module: 'adblock',
    defaultEnabled: true,
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
  },
  {
    id: 'peter-lowe',
    name: 'Peter Lowe’s Ad and tracking server list',
    description: 'A hosts-style list of ad and tracking servers.',
    module: 'adblock',
    defaultEnabled: true,
    homepage: 'https://pgl.yoyo.org/adservers/',
    license: 'McRae GPL',
  },
  {
    id: 'cookies',
    name: 'uBlock filters – Cookie notices',
    description: 'Blocks or auto-rejects cookie consent pop-ups on thousands of sites.',
    module: 'cookies',
    defaultEnabled: true,
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
  },
  {
    id: 'url-cleaning',
    name: 'Clean URLs',
    description: 'Strips tracking parameters such as utm_source, fbclid and gclid from links.',
    module: 'privacy',
    defaultEnabled: true,
    license: 'GPL-3.0',
  },
  {
    id: 'privacy-headers',
    name: 'Global Privacy Control',
    description: 'Sends the Sec-GPC and DNT headers, telling sites you do not consent to being sold or tracked.',
    module: 'privacy',
    defaultEnabled: true,
    license: 'GPL-3.0',
  },
];

export const RULESET_IDS = RULESETS.map((r) => r.id);

/** Cap on regex rules per static ruleset (Chrome rejects more than 1000). */
export const MAX_REGEX_RULES_PER_RULESET = 1000;

/** Name of the DOM event the MAIN-world fingerprint shield uses to report. */
export const FP_EVENT = 'shomer:fp-report';

/** The number of distinct first-party sites a tracker must be seen on. */
export const DEFAULT_LEARNING_THRESHOLD = 3;

export const REPO_URL = 'https://github.com/shomer-privacy/shomer';
