// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { candidateSelectors, looksGenerated, uniquePath } from '../../src/content/picker/selector';

beforeEach(() => {
  document.body.innerHTML = `
    <main id="main">
      <section class="feed">
        <div class="ad-slot css-1x2y3z"><img id="pic" src="https://ads.example.com/banner.png"></div>
        <div class="ad-slot"><span>2</span></div>
        <div class="post"><p>text</p><p id="target">more</p></div>
      </section>
    </main>`;
});

describe('looksGenerated', () => {
  it.each([
    ['css-1x2y3z', true],
    ['sc-AbCdE', true],
    ['a8f3e9c1', true],
    ['xH3kQ9zP2', true],
    ['item12345', true],
    ['ad-slot', false],
    ['sidebar', false],
    ['h1', false],
  ])('%s → %s', (token, generated) => {
    expect(looksGenerated(token)).toBe(generated);
  });
});

describe('uniquePath', () => {
  it('matches exactly the element', () => {
    for (const el of Array.from(document.querySelectorAll('main *'))) {
      const path = uniquePath(el);
      expect(document.querySelectorAll(path)).toHaveLength(1);
      expect(document.querySelector(path)).toBe(el);
    }
  });

  it('anchors on stable ids', () => {
    expect(uniquePath(document.getElementById('target')!)).toBe('p#target');
  });
});

describe('candidateSelectors', () => {
  it('offers specific and broad selectors with match counts, skipping generated classes', () => {
    const el = document.querySelector('.ad-slot')!;
    const candidates = candidateSelectors(el);
    expect(candidates[0]?.count).toBe(1);
    const broad = candidates.find((c) => c.selector === 'div.ad-slot');
    expect(broad?.count).toBe(2);
    expect(candidates.some((c) => c.selector.includes('css-1x2y3z'))).toBe(false);
  });

  it('offers a URL-based selector for media', () => {
    const candidates = candidateSelectors(document.getElementById('pic')!);
    expect(candidates.map((c) => c.selector)).toContain('img[src*="ads.example.com/"]');
  });
});
