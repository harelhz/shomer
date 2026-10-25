import { describe, expect, it } from 'vitest';
import {
  badfilterKey,
  isSafeSelector,
  parseFilter,
  splitScriptletArgs,
  type NetworkFilter,
} from '../../src/shared/filters/parser';

const network = (line: string) => {
  const f = parseFilter(line);
  expect(f?.kind).toBe('network');
  return f as NetworkFilter;
};

describe('parseFilter: comments and blanks', () => {
  it.each(['', '   ', '! comment', '[Adblock Plus 2.0]', '# hosts-style comment'])('ignores %j', (line) => {
    expect(parseFilter(line)).toBeNull();
  });
});

describe('parseFilter: network filters', () => {
  it('parses a plain domain anchor', () => {
    const f = network('||ads.example.com^');
    expect(f.pattern).toBe('||ads.example.com^');
    expect(f.exception).toBe(false);
    expect(f.types).toBeNull();
  });

  it('parses exceptions and options', () => {
    const f = network('@@||cdn.example.com^$script,image,third-party,domain=a.com|~b.a.com');
    expect(f.exception).toBe(true);
    expect(f.types).toEqual(['script', 'image']);
    expect(f.party).toBe('third');
    expect(f.domains).toEqual({ include: ['a.com'], exclude: ['b.a.com'] });
  });

  it('understands uBO aliases', () => {
    const f = network('||x.com^$xhr,frame,1p,css');
    expect(f.types).toEqual(['xmlhttprequest', 'sub_frame', 'stylesheet']);
    expect(f.party).toBe('first');
  });

  it('records negated types separately', () => {
    const f = network('/banner/*$~image,~script');
    expect(f.types).toBeNull();
    expect(f.excludedTypes).toEqual(['image', 'script']);
  });

  it('parses regex patterns without mistaking the $ anchor for options', () => {
    expect(network('/ads\\.js$/').regex).toBe('ads\\.js$');
    const f = network('/^https?:\\/\\/ad[0-9]\\./$script');
    expect(f.regex).toBe('^https?:\\/\\/ad[0-9]\\.');
    expect(f.types).toEqual(['script']);
  });

  it('parses options-only filters', () => {
    const f = network('$script,domain=example.com');
    expect(f.pattern).toBe('');
    expect(f.domains.include).toEqual(['example.com']);
  });

  it('parses redirect, removeparam, important, match-case and methods', () => {
    expect(network('||g.com/a.js$script,redirect=noopjs:10').redirect).toBe('noopjs');
    expect(network('$removeparam=utm_source').removeparam).toBe('utm_source');
    expect(network('||x.com^$important').important).toBe(true);
    expect(network('/Ad/$match-case').matchCase).toBe(true);
    const m = network('||x.com^$method=post|~get');
    expect(m.methods).toEqual(['post']);
    expect(m.excludedMethods).toEqual(['get']);
  });

  it('punycodes internationalised domains', () => {
    expect(network('||x.com^$domain=bücher.de').domains.include).toEqual(['xn--bcher-kva.de']);
  });

  it('rejects options it cannot express', () => {
    expect(parseFilter('||x.com^$csp=script-src none')).toMatchObject({ kind: 'unsupported', reason: 'option:csp' });
    expect(parseFilter('||x.com^$popup')).toMatchObject({ kind: 'unsupported', reason: 'popup' });
    expect(parseFilter('||x.com^$frobnicate')).toMatchObject({
      kind: 'unsupported',
      reason: 'unknown-option:frobnicate',
    });
    expect(parseFilter('||x.com^$domain=/re/')).toMatchObject({ kind: 'unsupported', reason: 'regex-domain' });
  });

  it('only allows cosmetic options on exceptions', () => {
    expect(network('@@||x.com^$generichide').generichide).toBe(true);
    expect(parseFilter('||x.com^$generichide')).toMatchObject({ kind: 'unsupported' });
  });
});

describe('parseFilter: cosmetic filters', () => {
  it('parses generic and specific hiding filters', () => {
    expect(parseFilter('##.ad-banner')).toMatchObject({
      kind: 'cosmetic',
      selector: '.ad-banner',
      domains: { include: [], exclude: [] },
    });
    expect(parseFilter('example.com,~shop.example.com##div.sponsor')).toMatchObject({
      kind: 'cosmetic',
      exception: false,
      domains: { include: ['example.com'], exclude: ['shop.example.com'] },
    });
  });

  it('parses exceptions and entities', () => {
    expect(parseFilter('example.*#@#.ad')).toMatchObject({
      kind: 'cosmetic',
      exception: true,
      domains: { include: ['example.*'] },
    });
  });

  it('detects procedural selectors', () => {
    expect(parseFilter('example.com##div:has-text(Sponsored)')).toMatchObject({ procedural: true });
    expect(parseFilter('example.com#?#div:-abp-has(> .ad)')).toMatchObject({ procedural: true });
    expect(parseFilter('example.com##div:has(> .ad)')).toMatchObject({ procedural: false });
  });

  it('converts CSS injection to :style()', () => {
    expect(parseFilter('example.com#$#.x { color: red }')).toMatchObject({ selector: '.x:style(color: red)' });
    expect(parseFilter('example.com##.x {height: 0 !important}')).toMatchObject({
      selector: '.x:style(height: 0 !important)',
    });
  });

  it('refuses generic procedural filters and unsafe selectors', () => {
    expect(parseFilter('##div:has-text(ad)')).toMatchObject({ kind: 'unsupported', reason: 'generic-procedural' });
    expect(parseFilter('example.com##a[href="x"')).toMatchObject({ kind: 'unsupported', reason: 'unsafe-selector' });
    expect(parseFilter('example.com##^script:has-text(x)')).toMatchObject({
      kind: 'unsupported',
      reason: 'html-filtering',
    });
  });

  it('does not confuse URL fragments with cosmetic separators', () => {
    expect(parseFilter('||example.com/#ad')?.kind).toBe('network');
  });
});

describe('parseFilter: scriptlets', () => {
  it('parses name and arguments', () => {
    expect(parseFilter('example.com##+js(set-constant, ads.enabled, false)')).toMatchObject({
      kind: 'scriptlet',
      name: 'set-constant',
      args: ['ads.enabled', 'false'],
    });
  });

  it('accepts the disable-all exception', () => {
    expect(parseFilter('example.com#@#+js()')).toMatchObject({ kind: 'scriptlet', exception: true, name: '' });
  });

  it('rejects generic scriptlets', () => {
    expect(parseFilter('##+js(nowebrtc)')).toMatchObject({ kind: 'unsupported', reason: 'generic-scriptlet' });
  });

  it('splits arguments with escapes and quotes', () => {
    // Commas split even inside quotes (as in uBO); only `\,` is a literal comma.
    expect(splitScriptletArgs("a, 'b, c', d\\, e ,  f")).toEqual(['a', "'b", "c'", 'd, e', 'f']);
    expect(splitScriptletArgs('"x,y"')).toEqual(['"x', 'y"']);
    expect(splitScriptletArgs('"quoted"')).toEqual(['quoted']);
  });
});

describe('parseFilter: hosts files', () => {
  it('parses hosts entries and skips localhost', () => {
    expect(parseFilter('0.0.0.0 ads.example.com', { format: 'hosts' })).toMatchObject({
      kind: 'hosts',
      domain: 'ads.example.com',
    });
    expect(parseFilter('127.0.0.1 tracker.net # comment', { format: 'hosts' })).toMatchObject({
      domain: 'tracker.net',
    });
    expect(parseFilter('127.0.0.1 localhost', { format: 'hosts' })).toBeNull();
    expect(parseFilter('# comment', { format: 'hosts' })).toBeNull();
  });
});

describe('isSafeSelector', () => {
  it.each([
    ['.ad', true],
    ['a[href^="https://x"]', true],
    ['div:not(.a, .b)', true],
    ['.a{background:url(//evil)}', false],
    ['.a /* x */', false],
    ['div[a="x"', false],
    ['div:has(.a', false],
    ['div)', false],
  ])('%s → %s', (selector, safe) => {
    expect(isSafeSelector(selector)).toBe(safe);
  });
});

describe('badfilterKey', () => {
  it('matches a filter with its $badfilter, regardless of option order', () => {
    expect(badfilterKey('||x.com^$script,third-party,badfilter')).toBe(badfilterKey('||x.com^$third-party,script'));
    expect(badfilterKey('||x.com^$badfilter')).toBe('||x.com^');
  });
});
