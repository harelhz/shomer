import { describe, expect, it } from 'vitest';
import { PRIORITY } from '../../src/shared/constants';
import {
  convertHostsEntry,
  convertNetworkFilter,
  isRe2Compatible,
  optimizeRules,
  pruneSubdomains,
} from '../../src/shared/filters/dnr';
import { parseFilter, type HostsEntry, type NetworkFilter } from '../../src/shared/filters/parser';
import type { DnrRuleDraft } from '../../src/shared/dnr-types';

function convert(line: string, priorityOffset = 0) {
  const f = parseFilter(line) as NetworkFilter;
  return convertNetworkFilter(f, { priorityOffset });
}

function rule(line: string): DnrRuleDraft {
  const r = convert(line);
  if (r.ok !== true) throw new Error(`expected a rule for ${line}: ${JSON.stringify(r)}`);
  return r.rule;
}

describe('convertNetworkFilter', () => {
  it('turns ||domain^ into requestDomains', () => {
    expect(rule('||ads.example.com^')).toEqual({
      priority: PRIORITY.LIST_BLOCK,
      action: { type: 'block' },
      condition: { requestDomains: ['ads.example.com'] },
    });
  });

  it('keeps other patterns as urlFilter, case-insensitive by default', () => {
    expect(rule('/banner/ad-*.gif').condition).toEqual({
      urlFilter: '/banner/ad-*.gif',
      isUrlFilterCaseSensitive: false,
    });
    expect(rule('/Ad/$match-case').condition.isUrlFilterCaseSensitive).toBe(true);
  });

  it('maps party, domain and type options', () => {
    expect(rule('||t.com^$script,third-party,domain=a.com|~b.a.com').condition).toEqual({
      requestDomains: ['t.com'],
      domainType: 'thirdParty',
      initiatorDomains: ['a.com'],
      excludedInitiatorDomains: ['b.a.com'],
      resourceTypes: ['script'],
    });
  });

  it('never lets negated types match main_frame', () => {
    expect(rule('||t.com^$~image').condition.excludedResourceTypes).toEqual(['image', 'main_frame']);
  });

  it('maps $document on a block filter to main_frame, and $all to everything', () => {
    expect(rule('||evil.com^$document').condition.resourceTypes).toEqual(['main_frame']);
    expect(rule('||evil.com^$all').condition.resourceTypes).toContain('main_frame');
  });

  it('implements the ABP precedence ladder', () => {
    expect(rule('||a.com^').priority).toBe(PRIORITY.LIST_BLOCK);
    expect(rule('||a.com/x.js$script,redirect=noopjs').priority).toBe(PRIORITY.LIST_REDIRECT);
    expect(rule('@@||a.com^').priority).toBe(PRIORITY.LIST_ALLOW);
    expect(rule('||a.com^$important').priority).toBe(PRIORITY.LIST_IMPORTANT_BLOCK);
    expect(rule('@@||a.com^$important').priority).toBe(PRIORITY.LIST_IMPORTANT_ALLOW);
  });

  it('shifts priorities for "My filters"', () => {
    const r = convert('||a.com^', PRIORITY.CUSTOM_OFFSET);
    expect(r.ok === true && r.rule.priority).toBe(PRIORITY.LIST_BLOCK + PRIORITY.CUSTOM_OFFSET);
  });

  it('turns document exceptions into allowAllRequests', () => {
    expect(rule('@@||trusted.com^$document')).toEqual({
      priority: PRIORITY.LIST_ALLOW,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: ['trusted.com'], resourceTypes: ['main_frame', 'sub_frame'] },
    });
  });

  it('redirects to bundled surrogates, and blocks when there is none', () => {
    expect(rule('||g.com/a.js$script,redirect=google-analytics_analytics.js').action).toEqual({
      type: 'redirect',
      redirect: { extensionPath: '/web_accessible_resources/google-analytics.js' },
    });
    expect(rule('||g.com/a.mp4$media,redirect=noopmp4-1s').action).toEqual({ type: 'block' });
  });

  it('implements removeparam with a query transform', () => {
    const r = rule('$removeparam=fbclid');
    expect(r.action).toEqual({
      type: 'redirect',
      redirect: { transform: { queryTransform: { removeParams: ['fbclid'] } } },
    });
    expect(r.condition.resourceTypes).toEqual(['main_frame', 'sub_frame', 'xmlhttprequest']);
    expect(convert('$removeparam=/^utm_/')).toEqual({ ok: false, reason: 'removeparam-regex' });
  });

  it('keeps regex filters only when RE2 can run them', () => {
    expect(rule('/^https?:\\/\\/ad\\d+\\./').condition.regexFilter).toBe('^https?:\\/\\/ad\\d+\\.');
    expect(convert('/(?!foo)bar/')).toEqual({ ok: false, reason: 'regex-unsupported' });
  });

  it('refuses to turn a site-specific filter into a global one', () => {
    expect(convert('||x.com/ad.js$domain=example.*')).toEqual({ ok: false, reason: 'entity-domains' });
  });

  it('refuses filters that would match everything', () => {
    expect(convert('*$third-party')).toEqual({ ok: false, reason: 'too-broad' });
    expect(convert('*$ping,third-party').ok).toBe(true);
  });

  it('leaves cosmetic-only exceptions to the cosmetic compiler', () => {
    expect(convert('@@||x.com^$generichide')).toEqual({ ok: 'cosmetic' });
  });

  it('skips redirect-rule, which only applies on top of another block', () => {
    expect(convert('||x.com^$script,redirect-rule=noopjs')).toEqual({ ok: false, reason: 'redirect-rule' });
  });

  it('normalises wildcard-anchored patterns', () => {
    expect(rule('||*/ads/$script').condition.urlFilter).toBe('/ads/');
    expect(rule('*/banner*$image').condition.urlFilter).toBe('/banner');
  });
});

describe('convertHostsEntry', () => {
  it('blocks the domain', () => {
    const r = convertHostsEntry({ kind: 'hosts', raw: '', domain: 'Ads.Example.com' } as HostsEntry);
    expect(r.ok === true && r.rule.condition).toEqual({ requestDomains: ['ads.example.com'] });
  });
});

describe('isRe2Compatible', () => {
  it.each([
    ['^https?://', true],
    ['(?=x)', false],
    ['(?<!x)y', false],
    ['(a)\\1', false],
    ['x'.repeat(300), false],
    ['[', false],
  ])('%s → %s', (re, ok) => {
    expect(isRe2Compatible(re)).toBe(ok);
  });
});

describe('optimizeRules', () => {
  it('merges domain-only block rules and prunes covered subdomains', () => {
    const rules = ['||a.com^', '||b.com^', '||x.a.com^', '||c.com^$script'].map(rule);
    const optimized = optimizeRules(rules);
    expect(optimized).toHaveLength(2);
    expect(optimized.find((r) => !r.condition.resourceTypes)?.condition.requestDomains).toEqual(['a.com', 'b.com']);
  });

  it('merges rules that differ only by initiator domain', () => {
    const optimized = optimizeRules(['||t.com^$domain=a.com', '||t.com^$domain=b.com'].map(rule));
    expect(optimized).toEqual([
      {
        priority: PRIORITY.LIST_BLOCK,
        action: { type: 'block' },
        condition: { requestDomains: ['t.com'], initiatorDomains: ['a.com', 'b.com'] },
      },
    ]);
  });

  it('does not merge rules with different actions or priorities', () => {
    expect(optimizeRules(['||a.com^', '@@||b.com^', '||c.com^$important'].map(rule))).toHaveLength(3);
  });

  it('deduplicates identical rules', () => {
    expect(optimizeRules(['/ad.js', '/ad.js'].map(rule))).toHaveLength(1);
  });
});

describe('pruneSubdomains', () => {
  it('keeps only the shortest covering domains', () => {
    expect(pruneSubdomains(['a.b.c.com', 'c.com', 'x.org', 'y.x.org', 'z.net'])).toEqual(['c.com', 'x.org', 'z.net']);
  });
});
