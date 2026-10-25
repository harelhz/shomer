import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  enabledRulesetIds,
  isModuleActive,
  sanitizeSettings,
  sitesWithModuleOff,
} from '../../src/shared/settings';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    expect(sanitizeSettings('nope')).toEqual(defaultSettings());
    expect(sanitizeSettings([1, 2])).toEqual(defaultSettings());
  });

  it('keeps valid values and drops invalid ones', () => {
    const s = sanitizeSettings({
      modules: { adblock: false, trackers: 'yes', bogus: true },
      rulesets: { easylist: false, 'not-a-list': true },
      fingerprintLevel: 'strict',
      cookieMode: 'accept-everything',
      learningThreshold: 99,
      allowlist: ['good.com', 'good.com', 'bad domain', '<script>', 42],
      siteModules: { 'a.com': { cookies: false, evil: false }, 'b c': { adblock: false } },
      trackerOverrides: { 'x.com': 'block', 'y.com': 'nuke' },
      customFilters: 123,
    });
    expect(s.modules).toEqual({ adblock: false, trackers: true, fingerprint: true, cookies: true });
    expect(s.rulesets.easylist).toBe(false);
    expect(s.rulesets).not.toHaveProperty('not-a-list');
    expect(s.fingerprintLevel).toBe('strict');
    expect(s.cookieMode).toBe('reject');
    expect(s.learningThreshold).toBe(3);
    expect(s.allowlist).toEqual(['good.com']);
    expect(s.siteModules).toEqual({ 'a.com': { cookies: false } });
    expect(s.trackerOverrides).toEqual({ 'x.com': 'block' });
    expect(s.customFilters).toBe('');
  });
});

describe('module state', () => {
  const s = sanitizeSettings({ allowlist: ['trusted.com'], siteModules: { 'news.com': { cookies: false } } });

  it('combines global switches, the allowlist and per-site overrides', () => {
    expect(isModuleActive(s, 'example.com', 'cookies')).toBe(true);
    expect(isModuleActive(s, 'news.com', 'cookies')).toBe(false);
    expect(isModuleActive(s, 'news.com', 'adblock')).toBe(true);
    expect(isModuleActive(s, 'trusted.com', 'adblock')).toBe(false);
    expect(sitesWithModuleOff(s, 'cookies')).toEqual(['news.com', 'trusted.com']);
  });

  it('enables rulesets only when their module is on', () => {
    const off = sanitizeSettings({ modules: { cookies: false } });
    expect(enabledRulesetIds(off)).not.toContain('cookies');
    expect(enabledRulesetIds(off)).toContain('easylist');
    expect(enabledRulesetIds(off)).toContain('privacy-headers');
  });
});
