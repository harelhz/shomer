// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { findGenericBanner, findRejectButton, queryDeep, runSteps } from '../../src/content/cookies';
import { CMP_RULES, REJECT_TEXT } from '../../src/data/cookie-rules';
import { cookieBannerCss } from '../../src/data/cookie-banners';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findRejectButton', () => {
  it.each([
    'Reject all',
    'Decline',
    'Only necessary cookies',
    'Continue without accepting',
    'דחה הכל',
    'רק עוגיות הכרחיות',
    'Alle ablehnen',
    'Tout refuser',
    'Rechazar todo',
  ])('finds %j', (label) => {
    document.body.innerHTML = `<div id="b"><button>Accept all</button><button>${label}</button></div>`;
    expect(findRejectButton(document.getElementById('b')!)?.textContent).toBe(label);
  });

  it.each(['Accept all', 'אישור', 'OK', 'Manage preferences', 'Learn more about how we reject spam'])(
    'never picks %j',
    (label) => {
      document.body.innerHTML = `<div id="b"><button>${label}</button></div>`;
      expect(findRejectButton(document.getElementById('b')!)).toBeNull();
    },
  );
});

describe('queryDeep', () => {
  it('pierces open shadow roots with >>>', () => {
    const host = document.createElement('div');
    host.id = 'usercentrics-root';
    host.attachShadow({ mode: 'open' }).innerHTML = '<button data-testid="uc-deny-all-button">Deny</button>';
    document.body.append(host);
    expect(queryDeep('#nope, #usercentrics-root >>> [data-testid="uc-deny-all-button"]')?.textContent).toBe('Deny');
  });
});

describe('runSteps', () => {
  it('follows if/else branches and clicks', async () => {
    document.body.innerHTML = '<button id="settings">Settings</button>';
    const clicked: string[] = [];
    document.getElementById('settings')!.addEventListener('click', () => {
      clicked.push('settings');
      const save = document.createElement('button');
      save.id = 'save';
      save.addEventListener('click', () => clicked.push('save'));
      document.body.append(save);
    });
    const ok = await runSteps([
      { if: '#reject', then: [{ click: '#reject' }], else: [{ click: '#settings' }, { click: '#save' }] },
    ]);
    expect(ok).toBe(true);
    expect(clicked).toEqual(['settings', 'save']);
  });

  it('fails when a required element never appears', async () => {
    expect(await runSteps([{ click: '#missing', timeout: 150 }])).toBe(false);
    expect(await runSteps([{ click: '#missing', timeout: 150, optional: true }])).toBe(true);
  });
});

describe('findGenericBanner', () => {
  it('ignores dialogs that contain forms', () => {
    document.body.innerHTML = `<div role="dialog" style="position:fixed">We use cookies. Sign in: <input type="password"></div>`;
    expect(findGenericBanner(new WeakSet())).toBeNull();
  });
});

describe('CMP rules', () => {
  it('have unique ids and valid regexes', () => {
    expect(new Set(CMP_RULES.map((r) => r.id)).size).toBe(CMP_RULES.length);
    for (const r of CMP_RULES) {
      if (r.hosts) expect(() => new RegExp(r.hosts!)).not.toThrow();
      if (r.frame) expect(() => new RegExp(r.frame!)).not.toThrow();
    }
    expect(() => new RegExp(REJECT_TEXT, 'i')).not.toThrow();
  });

  it('use selectors the browser can parse', () => {
    const selectors = CMP_RULES.flatMap((r) => [
      r.detect,
      ...(JSON.stringify(r.reject).match(/"(click|if|waitFor|within)":"([^"\\]|\\.)*"/g) ?? []),
    ]);
    for (const raw of selectors) {
      const list = raw.replace(/^"\w+":"|"$/g, '').replace(/\\"/g, '"');
      for (const part of list.split(/\s*>>>\s*/)) expect(() => document.querySelector(part), part).not.toThrow();
    }
  });
});

describe('cookieBannerCss', () => {
  it('hides without display:none in reject mode, so CMP scripts keep working', () => {
    expect(cookieBannerCss('reject')).toContain('opacity:0');
    expect(cookieBannerCss('reject')).not.toContain('display:none');
    expect(cookieBannerCss('hide')).toContain('display:none');
  });
});
