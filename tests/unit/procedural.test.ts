// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction, parseProcedural, selectElements, textPattern } from '../../src/content/procedural';

function ids(selector: string): string[] {
  const task = parseProcedural(selector);
  if (!task) throw new Error(`could not parse ${selector}`);
  return selectElements(task).map((e) => e.id);
}

beforeEach(() => {
  document.body.innerHTML = `
    <div class="feed">
      <article id="a1" class="card"><span>Sponsored</span><p>Buy</p></article>
      <article id="a2" class="card"><span>News</span><p>Story</p></article>
      <article id="a3" class="card"><div class="inner"><b id="label">Promoted</b></div></article>
    </div>
    <div id="side" data-ad-unit="top">side</div>`;
});

describe('parseProcedural', () => {
  it('splits the base selector from the operators', () => {
    expect(parseProcedural('.card:has-text(Sponsored)')).toMatchObject({
      base: '.card',
      ops: [{ type: 'has-text' }],
      action: { type: 'hide' },
    });
  });

  it('keeps native pseudo-classes and attribute selectors in CSS', () => {
    expect(parseProcedural('a[href*=":has-text("]:not(.x):has-text(y)')?.base).toBe('a[href*=":has-text("]:not(.x)');
  });

  it('recognises actions', () => {
    expect(parseProcedural('.x:remove()')?.action).toEqual({ type: 'remove' });
    expect(parseProcedural('.x:style(height: 0 !important)')?.action).toEqual({
      type: 'style',
      declarations: [['height', '0']],
    });
    expect(parseProcedural('.x:remove-attr(onclick)')?.action).toEqual({ type: 'remove-attr', name: 'onclick' });
  });

  it('rejects unbalanced input', () => {
    expect(parseProcedural('.x:has-text(oops')).toBeNull();
  });
});

describe('selectElements', () => {
  it(':has-text with literals and regexes', () => {
    expect(ids('.card:has-text(Sponsored)')).toEqual(['a1']);
    expect(ids('.card:has-text(/sponsored|promoted/i)')).toEqual(['a1', 'a3']);
    expect(ids('.card:-abp-contains(News)')).toEqual(['a2']);
  });

  it(':upward by count and by selector', () => {
    expect(ids('#label:upward(2)')).toEqual(['a3']);
    expect(ids('#label:upward(.card)')).toEqual(['a3']);
  });

  it(':has and :not with procedural arguments', () => {
    expect(ids('.card:has(span:has-text(Sponsored))')).toEqual(['a1']);
    expect(ids('.card:not(:has-text(News))')).toEqual(['a1', 'a3']);
  });

  it('continues with CSS after an operator', () => {
    expect(ids('.feed:has-text(Promoted) > #a2')).toEqual(['a2']);
  });

  it(':matches-attr and :min-text-length', () => {
    expect(ids('div:matches-attr(/^data-ad/)')).toEqual(['side']);
    expect(ids('.card:min-text-length(9)')).toEqual(['a1', 'a2']);
  });

  it(':xpath', () => {
    expect(ids('.feed:xpath(./article[2])')).toEqual(['a2']);
  });
});

describe('applyAction', () => {
  it('hides, removes and strips attributes', () => {
    const el = document.getElementById('a1')!;
    applyAction({ type: 'hide' }, el);
    expect(el.style.getPropertyValue('display')).toBe('none');
    expect(el.style.getPropertyPriority('display')).toBe('important');
    applyAction({ type: 'remove-attr', name: 'class' }, el);
    expect(el.hasAttribute('class')).toBe(false);
    applyAction({ type: 'remove' }, el);
    expect(document.getElementById('a1')).toBeNull();
  });
});

describe('textPattern', () => {
  it('escapes literals and parses regexes', () => {
    expect(textPattern('a.b').test('axb')).toBe(false);
    expect(textPattern('/a.b/').test('axb')).toBe(true);
    expect(textPattern('/AD/i').test('ad')).toBe(true);
  });
});
