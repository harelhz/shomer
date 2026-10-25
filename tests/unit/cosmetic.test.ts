import { describe, expect, it } from 'vitest';
import { compileFilterList } from '../../src/shared/filters/compiler';
import {
  buildCss,
  hostnameKeys,
  lowlyGenericKey,
  queryCosmetics,
  queryLowlyGeneric,
} from '../../src/shared/filters/cosmetic';

describe('lowlyGenericKey', () => {
  it.each([
    ['.ad-banner', '.ad-banner'],
    ['#ads', '#ads'],
    ['.ad > img', '.ad'],
    ['.ad.big', '.ad'],
    ['#sidebar-ad[data-x]', '#sidebar-ad'],
    ['div.ad', null],
    ['a[href*="doubleclick"]', null],
    ['.a, .b', null],
    ['.\\31 ad', null],
  ])('%s → %s', (selector, key) => {
    expect(lowlyGenericKey(selector)).toBe(key);
  });
});

describe('hostnameKeys', () => {
  it('lists the hostname, its parents and its entities', () => {
    expect(hostnameKeys('www.example.co.uk', 'co.uk')).toEqual([
      'www.example.co.uk',
      'example.co.uk',
      'co.uk',
      'uk',
      'www.example.*',
      'example.*',
    ]);
  });
});

describe('queryCosmetics', () => {
  const list = compileFilterList(
    [
      '##.ad-banner',
      '##a[href*="ads.example"]',
      '~news.com##.promo',
      'news.com##.sponsored',
      'news.com#@#.ad-banner',
      'example.*##.entity-ad',
      'shop.com##.card:has-text(Sponsored)',
      '@@||clean.com^$generichide',
      '@@||trusted.com^$elemhide',
    ].join('\n'),
  ).cosmetic;

  const query = (host: string, suffix: string) => queryCosmetics([list], hostnameKeys(host, suffix));

  it('applies specific and highly generic filters', () => {
    const r = query('www.news.com', 'com');
    expect(r.selectors).toContain('.sponsored');
    expect(r.selectors).toContain('a[href*="ads.example"]');
    expect(r.generic).toBe(true);
  });

  it('honours exceptions for lowly generic lookups', () => {
    const news = query('news.com', 'com');
    expect(queryLowlyGeneric([list], ['.ad-banner', '.promo'], news.exceptions)).toEqual([]);
    const other = query('blog.org', 'org');
    expect(queryLowlyGeneric([list], ['.ad-banner', '.promo'], other.exceptions).sort()).toEqual([
      '.ad-banner',
      '.promo',
    ]);
  });

  it('matches entities', () => {
    expect(query('example.de', 'de').selectors).toContain('.entity-ad');
    expect(query('example.co.uk', 'co.uk').selectors).toContain('.entity-ad');
  });

  it('returns procedural filters separately', () => {
    expect(query('shop.com', 'com').procedural).toEqual(['.card:has-text(Sponsored)']);
  });

  it('supports $generichide and $elemhide', () => {
    const clean = query('clean.com', 'com');
    expect(clean.generic).toBe(false);
    expect(clean.selectors).not.toContain('a[href*="ads.example"]');
    expect(query('trusted.com', 'com')).toMatchObject({ selectors: [], procedural: [], generic: false });
  });
});

describe('buildCss', () => {
  it('emits one rule per selector', () => {
    expect(buildCss(['.a', '#b'])).toBe('.a{display:none!important}\n#b{display:none!important}');
  });

  it('turns :style() into declarations, forcing !important', () => {
    expect(buildCss(['.x:style(height: 0; color: red !important)'])).toBe(
      '.x{height: 0 !important;color: red !important}',
    );
  });

  it('drops url() so filters cannot make the browser fetch anything', () => {
    expect(buildCss(['.x:style(background: url(https://tracker.example/p.gif))'])).toBe('');
  });
});
