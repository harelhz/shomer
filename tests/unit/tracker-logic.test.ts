import { describe, expect, it } from 'vitest';
import {
  estimateEntropyBits,
  hasIdentifyingCookie,
  isIdentifyingValue,
  isSameParty,
  isYellowlisted,
  learnedAction,
  mdfpGroupOf,
  pruneDb,
  recordTracking,
  sanitizeTrackerDb,
  setCookieValue,
  yellowlistedSubdomains,
  type TrackerDb,
} from '../../src/background/tracker-logic';

describe('cookie entropy', () => {
  it.each(['true', 'en', 'en-US', 'he_IL', '1', 'accepted', '', '0'])('%j is not an identifier', (v) => {
    expect(isIdentifyingValue(v)).toBe(false);
  });

  it.each(['a8f3e9c1b2d4', '5f2b7c1e-8d3a-4e6f-9b0c-1d2e3f4a5b6c', 'GA1.2.1234567890.1700000000', 'k9Xq2LmZ7pRw'])(
    '%j is an identifier',
    (v) => {
      expect(isIdentifyingValue(v)).toBe(true);
    },
  );

  it('estimates entropy from length and alphabet', () => {
    expect(estimateEntropyBits('0123456789')).toBeCloseTo(10 * Math.log2(10));
    expect(estimateEntropyBits('abcABC')).toBeCloseTo(6 * Math.log2(52));
  });

  it('parses Cookie and Set-Cookie headers', () => {
    expect(hasIdentifyingCookie('lang=en; consent=true')).toBe(false);
    expect(hasIdentifyingCookie('lang=en; uid=8f14e45fceea167a5a36dedd4bea2543')).toBe(true);
    expect(setCookieValue('uid=abc123; Path=/; Secure')).toBe('abc123');
  });
});

describe('parties', () => {
  it('treats multi-domain first parties as one party', () => {
    expect(isSameParty('youtube.com', 'ytimg.com')).toBe(true);
    expect(isSameParty('google.co.il', 'youtube.com')).toBe(true);
    expect(isSameParty('ynet.co.il', 'yit.co.il')).toBe(true);
    expect(isSameParty('facebook.com', 'youtube.com')).toBe(false);
    expect(mdfpGroupOf('example.org')).toBeNull();
  });

  it('matches the yellowlist on subdomains', () => {
    expect(isYellowlisted('fonts.gstatic.com')).toBe(true);
    expect(isYellowlisted('cdn.jsdelivr.net')).toBe(true);
    expect(isYellowlisted('ads.example.com')).toBe(false);
    expect(yellowlistedSubdomains('google.com')).toContain('accounts.google.com');
  });
});

describe('recordTracking', () => {
  it('blocks after the threshold of distinct sites', () => {
    const db: TrackerDb = {};
    expect(recordTracking(db, 'tracker.net', 'a.com', 'cookie', 3, 1)).toEqual({
      changed: true,
      crossedThreshold: false,
    });
    recordTracking(db, 'tracker.net', 'a.com', 'cookie', 3, 2); // same site again
    recordTracking(db, 'tracker.net', 'b.com', 'fingerprint', 3, 3);
    expect(learnedAction('tracker.net', db['tracker.net'], 3)).toBe('none');
    expect(recordTracking(db, 'tracker.net', 'c.com', 'cookie', 3, 4).crossedThreshold).toBe(true);
    expect(learnedAction('tracker.net', db['tracker.net'], 3)).toBe('block');
    expect(db['tracker.net']).toMatchObject({
      sites: ['a.com', 'b.com', 'c.com'],
      signals: { cookie: 3, fingerprint: 1 },
      firstSeen: 1,
      lastSeen: 4,
    });
  });

  it('cookie-blocks yellowlisted domains instead of blocking them', () => {
    const db: TrackerDb = {};
    for (const s of ['a.com', 'b.com', 'c.com']) recordTracking(db, 'recaptcha.net', s, 'cookie', 3);
    expect(learnedAction('recaptcha.net', db['recaptcha.net'], 3)).toBe('cookieblock');
  });

  it('ignores first parties', () => {
    const db: TrackerDb = {};
    expect(recordTracking(db, 'ytimg.com', 'youtube.com', 'cookie', 3).changed).toBe(false);
    expect(db).toEqual({});
  });
});

describe('pruneDb', () => {
  it('drops the least useful records first', () => {
    const db: TrackerDb = {
      old: { sites: ['a'], firstSeen: 0, lastSeen: 1, signals: {} },
      recent: { sites: ['a'], firstSeen: 0, lastSeen: 9, signals: {} },
      blocked: { sites: ['a', 'b', 'c'], firstSeen: 0, lastSeen: 0, signals: {} },
    };
    pruneDb(db, 3, 2);
    expect(Object.keys(db).sort()).toEqual(['blocked', 'recent']);
  });
});

describe('sanitizeTrackerDb', () => {
  it('drops malformed entries from imported data', () => {
    const db = sanitizeTrackerDb({
      'good.com': { sites: ['a.com', 'a.com', '<script>'], firstSeen: 5, lastSeen: 6, signals: { cookie: 2 } },
      'bad domain': { sites: [] },
      'null.com': null,
    });
    expect(db).toEqual({
      'good.com': { sites: ['a.com'], firstSeen: 5, lastSeen: 6, signals: { cookie: 2, fingerprint: 0 } },
    });
  });
});
