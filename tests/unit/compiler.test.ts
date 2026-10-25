import { describe, expect, it } from 'vitest';
import { compileFilterList } from '../../src/shared/filters/compiler';

const LIST = `
[Adblock Plus 2.0]
! Title: test
||ads.example.com^
||tracker.example.net^$third-party
||ads.example.com/banner.js$script,badfilter
||removed.example^
||removed.example^$badfilter
@@||ads.example.com/allowed.js$script
##.ad
example.com##.local-ad
example.com##+js(set-constant, adblock, false)
example.com##+js(not-a-real-scriptlet)
||x.com^$popup
@@||nohide.com^$generichide
`;

describe('compileFilterList', () => {
  const result = compileFilterList(LIST, { collectUnsupported: true });

  it('produces network rules and honours $badfilter', () => {
    const domains = result.rules.flatMap((r) => r.condition.requestDomains ?? []);
    expect(domains).toContain('ads.example.com');
    expect(domains).not.toContain('removed.example');
  });

  it('builds the cosmetic bundle', () => {
    expect(result.cosmetic.lowly['.ad']).toEqual(['.ad']);
    expect(result.cosmetic.specific['example.com']).toEqual(['.local-ad']);
    expect(result.cosmetic.generichide).toEqual(['nohide.com']);
  });

  it('builds the scriptlet bundle with canonical names', () => {
    expect(result.scriptlets.entries['example.com']).toEqual([['set-constant', 'adblock', 'false']]);
  });

  it('reports what it could not convert, with line numbers', () => {
    expect(result.unsupportedLines.map((u) => u.reason)).toEqual(['scriptlet:not-a-real-scriptlet', 'popup']);
    expect(result.unsupportedLines[0]?.line).toBe(13);
    expect(result.stats.reasons).toEqual({ scriptlet: 1, popup: 1 });
  });

  it('can forbid scriptlets (for "My filters")', () => {
    const r = compileFilterList('example.com##+js(nowebrtc)', { allowScriptlets: false, collectUnsupported: true });
    expect(r.unsupportedLines[0]?.reason).toBe('scriptlets-not-allowed');
  });

  it('parses hosts files', () => {
    const r = compileFilterList('# hosts\n0.0.0.0 a.com\n0.0.0.0 b.com\n127.0.0.1 localhost', { format: 'hosts' });
    expect(r.rules).toEqual([
      { priority: 1, action: { type: 'block' }, condition: { requestDomains: ['a.com', 'b.com'] } },
    ]);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(compileFilterList(LIST))).toBe(JSON.stringify(compileFilterList(LIST)));
  });
});
