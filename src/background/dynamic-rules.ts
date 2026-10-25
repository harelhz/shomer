/**
 * Builds the dynamic declarativeNetRequest rules from settings and learned
 * trackers. Kept free of browser APIs so the whole precedence model can be
 * unit-tested; see PRIORITY in shared/constants.ts.
 */
import { PRIORITY, USER_DOMAIN_OFFSET } from '../shared/constants';
import { assignIds, optimizeRules } from '../shared/filters/dnr';
import { isUnsafeRule, type DnrAction, type DnrRule, type DnrRuleDraft } from '../shared/dnr-types';
import { sitesWithModuleOff, type Settings, type TrackerAction } from '../shared/settings';
import { mdfpGroupOf, yellowlistedSubdomains } from './tracker-logic';

export const MAX_DYNAMIC_RULES = 30_000;
export const MAX_UNSAFE_DYNAMIC_RULES = 5_000;

export interface DynamicRulesInput {
  settings: Settings;
  /** Learned trackers that crossed the threshold, without user overrides. */
  learned: { domain: string; action: Exclude<TrackerAction, 'allow'> }[];
  /** Compiled "My filters" network rules. */
  customRules: DnrRuleDraft[];
}

export interface DynamicRulesResult {
  rules: DnrRule[];
  dropped: number;
}

const COOKIEBLOCK: DnrAction = {
  type: 'modifyHeaders',
  requestHeaders: [{ header: 'cookie', operation: 'remove' }],
  responseHeaders: [{ header: 'set-cookie', operation: 'remove' }],
};

const withExclusions = (domains: string[]) => (domains.length > 0 ? { excludedInitiatorDomains: domains } : {});

function cookieblockRules(
  domains: string[],
  exclusions: string[],
  allowPriority: number,
  stripPriority: number,
): DnrRuleDraft[] {
  if (domains.length === 0) return [];
  const condition = { requestDomains: domains, domainType: 'thirdParty' as const, ...withExclusions(exclusions) };
  return [
    // The allow rule lets the request through any lower-priority block…
    { priority: allowPriority, action: { type: 'allow' }, condition },
    // …and a modifyHeaders rule only applies above the highest matching allow.
    { priority: stripPriority, action: COOKIEBLOCK, condition },
  ];
}

export function buildDynamicRules(input: DynamicRulesInput): DynamicRulesResult {
  const { settings } = input;
  const drafts: DnrRuleDraft[] = [];

  // 1. Fully trusted sites: nothing applies in their tabs.
  if (settings.allowlist.length > 0) {
    drafts.push({
      priority: PRIORITY.SITE_ALLOWLIST,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: settings.allowlist, resourceTypes: ['main_frame'] },
    });
  }

  // 2. Sites with "ad & content blocking" switched off: lift the filter lists only.
  const listsOff = Object.entries(settings.siteModules)
    .filter(([, o]) => o.adblock === false)
    .map(([site]) => site);
  if (listsOff.length > 0) {
    drafts.push({
      priority: PRIORITY.SITE_DISABLE_LISTS,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: listsOff, resourceTypes: ['main_frame'] },
    });
  }

  // 3. Learned trackers.
  if (settings.modules.trackers) {
    const trackersOff = sitesWithModuleOff(settings, 'trackers');
    const blockGroups = new Map<string, { domains: string[]; exclusions: string[] }>();
    const yellow: string[] = [];
    const cookieblocked: string[] = [];

    for (const { domain, action } of input.learned) {
      if (action === 'cookieblock') {
        cookieblocked.push(domain);
        continue;
      }
      // Never block a tracker on sites owned by the same organisation.
      const group = mdfpGroupOf(domain);
      const key = group ? group.join(',') : '';
      let entry = blockGroups.get(key);
      if (!entry) {
        entry = { domains: [], exclusions: [...new Set([...(group ?? []), ...trackersOff])] };
        blockGroups.set(key, entry);
      }
      entry.domains.push(domain);
      yellow.push(...yellowlistedSubdomains(domain));
    }

    for (const { domains, exclusions } of blockGroups.values()) {
      drafts.push({
        priority: PRIORITY.LEARNED_BLOCK,
        action: { type: 'block' },
        condition: { requestDomains: domains, domainType: 'thirdParty', ...withExclusions(exclusions) },
      });
    }
    drafts.push(
      ...cookieblockRules(
        [...new Set([...yellow, ...cookieblocked])],
        trackersOff,
        PRIORITY.LEARNED_YELLOW_ALLOW,
        PRIORITY.LEARNED_COOKIEBLOCK,
      ),
    );
  }

  // 4. Explicit per-domain choices. More specific domains get higher priority.
  for (const [domain, action] of Object.entries(settings.trackerOverrides)) {
    const base = PRIORITY.USER_DOMAIN_BASE + domain.split('.').length * 4;
    const condition = { requestDomains: [domain], domainType: 'thirdParty' as const };
    if (action === 'allow') {
      drafts.push({ priority: base + USER_DOMAIN_OFFSET.allow, action: { type: 'allow' }, condition });
    } else if (action === 'block') {
      drafts.push({ priority: base + USER_DOMAIN_OFFSET.block, action: { type: 'block' }, condition });
    } else {
      drafts.push(
        ...cookieblockRules(
          [domain],
          [],
          base + USER_DOMAIN_OFFSET.cookieblockAllow,
          base + USER_DOMAIN_OFFSET.cookieblockStrip,
        ),
      );
    }
  }

  // 5. My filters, which the user may write freely, go last so that quota
  //    overflow drops them rather than core protections.
  const core = optimizeRules(drafts);
  const custom = optimizeRules(input.customRules);

  const out: DnrRuleDraft[] = [];
  let unsafe = 0;
  let dropped = 0;
  for (const rule of [...core, ...custom]) {
    const isUnsafe = isUnsafeRule(rule);
    if (out.length >= MAX_DYNAMIC_RULES || (isUnsafe && unsafe >= MAX_UNSAFE_DYNAMIC_RULES)) {
      dropped++;
      continue;
    }
    if (isUnsafe) unsafe++;
    out.push(rule);
  }
  return { rules: assignIds(out), dropped };
}
