import { describe, expect, it } from 'vitest';
import { buildDynamicRules, MAX_DYNAMIC_RULES } from '../../src/background/dynamic-rules';
import { PRIORITY } from '../../src/shared/constants';
import { defaultSettings, type Settings } from '../../src/shared/settings';
import type { DnrRuleDraft } from '../../src/shared/dnr-types';

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...patch };
}

function build(
  patch: Partial<Settings> = {},
  learned: Parameters<typeof buildDynamicRules>[0]['learned'] = [],
  customRules: DnrRuleDraft[] = [],
) {
  return buildDynamicRules({ settings: settings(patch), learned, customRules });
}

describe('buildDynamicRules', () => {
  it('produces nothing for a fresh install', () => {
    expect(build().rules).toEqual([]);
  });

  it('allowlists trusted sites at the top of the ladder', () => {
    const { rules } = build({ allowlist: ['bank.co.il'] });
    expect(rules).toEqual([
      {
        id: 1,
        priority: PRIORITY.SITE_ALLOWLIST,
        action: { type: 'allowAllRequests' },
        condition: { requestDomains: ['bank.co.il'], resourceTypes: ['main_frame'] },
      },
    ]);
  });

  it('lifts only the filter lists when ad blocking is off for a site', () => {
    const [rule] = build({ siteModules: { 'news.com': { adblock: false } } }).rules;
    expect(rule?.priority).toBe(PRIORITY.SITE_DISABLE_LISTS);
    expect(rule!.priority).toBeGreaterThan(PRIORITY.LIST_IMPORTANT_ALLOW);
    expect(rule!.priority).toBeLessThan(PRIORITY.LEARNED_BLOCK);
  });

  it('blocks learned trackers as third parties, sparing their own organisation', () => {
    const { rules } = build({}, [
      { domain: 'tracker.net', action: 'block' },
      { domain: 'facebook.com', action: 'block' },
    ]);
    const plain = rules.find((r) => r.condition.requestDomains?.includes('tracker.net'));
    expect(plain).toMatchObject({
      priority: PRIORITY.LEARNED_BLOCK,
      action: { type: 'block' },
      condition: { domainType: 'thirdParty' },
    });
    expect(plain?.condition.excludedInitiatorDomains).toBeUndefined();
    const fb = rules.find((r) => r.condition.requestDomains?.includes('facebook.com'));
    expect(fb?.condition.excludedInitiatorDomains).toContain('instagram.com');
  });

  it('keeps yellowlisted subdomains working, without cookies', () => {
    const { rules } = build({}, [{ domain: 'google.com', action: 'block' }]);
    const allow = rules.find((r) => r.action.type === 'allow');
    const strip = rules.find((r) => r.action.type === 'modifyHeaders');
    expect(allow?.condition.requestDomains).toContain('accounts.google.com');
    expect(allow?.priority).toBe(PRIORITY.LEARNED_YELLOW_ALLOW);
    // modifyHeaders only applies above the highest matching allow rule.
    expect(strip!.priority).toBeGreaterThan(allow!.priority);
    expect(strip?.action.requestHeaders).toEqual([{ header: 'cookie', operation: 'remove' }]);
    expect(strip?.action.responseHeaders).toEqual([{ header: 'set-cookie', operation: 'remove' }]);
  });

  it('respects per-site and global tracker switches', () => {
    const learned = [{ domain: 'tracker.net', action: 'block' as const }];
    const perSite = build({ siteModules: { 'news.com': { trackers: false } } }, learned).rules;
    expect(perSite[0]?.condition.excludedInitiatorDomains).toEqual(['news.com']);
    expect(build({ modules: { ...defaultSettings().modules, trackers: false } }, learned).rules).toEqual([]);
  });

  it('gives more specific user choices higher priority', () => {
    const { rules } = build({ trackerOverrides: { 'example.com': 'block', 'cdn.example.com': 'allow' } });
    const block = rules.find((r) => r.action.type === 'block')!;
    const allow = rules.find((r) => r.action.type === 'allow')!;
    expect(allow.priority).toBeGreaterThan(block.priority);
    expect(block.priority).toBeGreaterThan(PRIORITY.LEARNED_COOKIEBLOCK);
    expect(allow.priority).toBeLessThan(PRIORITY.CUSTOM_OFFSET);
  });

  it('includes custom rules and assigns sequential ids', () => {
    const custom: DnrRuleDraft = { priority: 101, action: { type: 'block' }, condition: { urlFilter: '/ad.js' } };
    const { rules } = build({ allowlist: ['a.com'] }, [], [custom]);
    expect(rules.map((r) => r.id)).toEqual([1, 2]);
    expect(rules[1]).toMatchObject(custom);
  });

  it('drops custom rules first when over the browser limit', () => {
    const custom: DnrRuleDraft[] = Array.from({ length: MAX_DYNAMIC_RULES + 5 }, (_, i) => ({
      priority: 101,
      action: { type: 'block' },
      condition: { urlFilter: `/ad${i}.js` },
    }));
    const result = build({ allowlist: ['a.com'] }, [], custom);
    expect(result.rules).toHaveLength(MAX_DYNAMIC_RULES);
    expect(result.rules[0]?.action.type).toBe('allowAllRequests');
    expect(result.dropped).toBe(6);
  });
});
