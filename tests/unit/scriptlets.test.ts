// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SCRIPTLETS } from '../../src/scriptlets/library';
import { SCRIPTLET_NAMES, canonicalScriptletName } from '../../src/scriptlets/names';
import { scriptletKeys, selectInvocations } from '../../src/scriptlets/runtime';
import { isSafeValue, patternToRegex } from '../../src/scriptlets/helpers';

const w = window as unknown as Record<string, unknown>;

describe('scriptlet registry', () => {
  it('implements every name the compiler accepts', () => {
    for (const name of SCRIPTLET_NAMES) expect(SCRIPTLETS[name], name).toBeTypeOf('function');
  });

  it('resolves uBO aliases', () => {
    expect(canonicalScriptletName('aopr')).toBe('abort-on-property-read');
    expect(canonicalScriptletName('nostif.js')).toBe('prevent-setTimeout');
    expect(canonicalScriptletName('trusted-set')).toBe('set-constant');
    expect(canonicalScriptletName('made-up')).toBeNull();
  });
});

describe('runtime selection', () => {
  const data = {
    entries: {
      'example.com': [['set-constant', 'a', 'true'], ['nowebrtc']],
      'shop.example.com': [['set-constant', 'b', 'false']],
      'example.*': [['set-constant', 'c', '1']],
    },
    exceptions: { 'shop.example.com': ['["nowebrtc"]'], 'safe.example.com': ['*'] },
  };

  it('collects entries for parents and entities, minus exceptions', () => {
    expect(selectInvocations(data, 'shop.example.com')).toEqual([
      ['set-constant', 'b', 'false'],
      ['set-constant', 'a', 'true'],
      ['set-constant', 'c', '1'],
    ]);
    expect(selectInvocations(data, 'safe.example.com')).toEqual([]);
  });

  it('builds hostname keys without a public suffix list', () => {
    expect(scriptletKeys('a.b.c')).toEqual(['a.b.c', 'b.c', 'c', 'a.*', 'a.b.*', 'b.*']);
  });
});

describe('helpers', () => {
  it('patternToRegex follows uBO semantics', () => {
    expect(patternToRegex('').test('anything')).toBe(true);
    expect(patternToRegex('a.b').test('axb')).toBe(false);
    expect(patternToRegex('/a.b/').test('axb')).toBe(true);
  });

  it('only lets untrusted scriptlets write harmless values', () => {
    expect(isSafeValue('accepted')).toBe(true);
    expect(isSafeValue('1')).toBe(true);
    expect(isSafeValue('99999')).toBe(false);
    expect(isSafeValue('tracking-id-123')).toBe(false);
  });
});

describe('scriptlet behaviour', () => {
  it('set-constant, including chains defined later', () => {
    SCRIPTLETS['set-constant']!('adsConfig.enabled', 'false');
    w.adsConfig = { enabled: true, other: 1 };
    expect((w.adsConfig as Record<string, unknown>).enabled).toBe(false);
    expect((w.adsConfig as Record<string, unknown>).other).toBe(1);
    SCRIPTLETS['set-constant']!('isAdBlockActive', 'noopFunc');
    expect((w.isAdBlockActive as () => unknown)()).toBeUndefined();
  });

  it('abort-on-property-read throws on access', () => {
    SCRIPTLETS['abort-on-property-read']!('detectAdblock');
    expect(() => w.detectAdblock).toThrow(ReferenceError);
  });

  it('prevent-setTimeout neuters matching callbacks only', () => {
    vi.useFakeTimers();
    const original = window.setTimeout;
    SCRIPTLETS['prevent-setTimeout']!('adblock', '');
    const hits: string[] = [];
    window.setTimeout(function adblockCheck() {
      hits.push('adblock');
    }, 10);
    window.setTimeout(() => hits.push('ok'), 10);
    vi.runAllTimers();
    expect(hits).toEqual(['ok']);
    window.setTimeout = original;
    vi.useRealTimers();
  });

  it('json-prune removes paths from parsed JSON', () => {
    const originalParse = JSON.parse;
    SCRIPTLETS['json-prune']!('playerAds adPlacements', '');
    expect(JSON.parse('{"playerAds":[1],"video":"x","adPlacements":{}}')).toEqual({ video: 'x' });
    JSON.parse = originalParse;
  });

  it('remove-attr strips attributes from matching elements', async () => {
    document.body.innerHTML = '<a id="l" href="#" onclick="track()">x</a>';
    SCRIPTLETS['remove-attr']!('onclick', '#l', 'asap');
    expect(document.getElementById('l')!.hasAttribute('onclick')).toBe(false);
  });

  it('set-local-storage-item refuses identifiers but accepts consent values', () => {
    SCRIPTLETS['set-local-storage-item']!('consent', 'accepted');
    SCRIPTLETS['set-local-storage-item']!('uid', 'abc123xyz');
    expect(localStorage.getItem('consent')).toBe('accepted');
    expect(localStorage.getItem('uid')).toBeNull();
  });

  it('nowebrtc replaces RTCPeerConnection', () => {
    w.RTCPeerConnection = function Real() {};
    SCRIPTLETS.nowebrtc!();
    const pc = new (w.RTCPeerConnection as new () => { createDataChannel(): void })();
    expect(pc.createDataChannel()).toBeUndefined();
  });
});
