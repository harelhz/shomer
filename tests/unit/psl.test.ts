import { describe, expect, it } from 'vitest';
import { createPublicSuffixList, isIpAddress } from '../../src/shared/psl';

// A subset of the real list, including the tricky rule kinds.
const psl = createPublicSuffixList(`
// comment
com
uk
co.uk
il
co.il
org.il
jp
*.kawasaki.jp
!city.kawasaki.jp
github.io
blogspot.com
`);

describe('Public Suffix List', () => {
  it.each([
    ['example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['a.b.c.example.co.uk', 'example.co.uk'],
    ['ynet.co.il', 'ynet.co.il'],
    ['www.idf.il', 'idf.il'],
    ['user.github.io', 'user.github.io'],
    ['foo.blogspot.com', 'foo.blogspot.com'],
    ['a.b.kawasaki.jp', 'a.b.kawasaki.jp'],
    ['www.city.kawasaki.jp', 'city.kawasaki.jp'],
    ['co.uk', 'co.uk'],
    ['localhost', 'localhost'],
    ['192.168.1.1', '192.168.1.1'],
    ['EXAMPLE.COM.', 'example.com'],
  ])('getDomain(%s) = %s', (host, domain) => {
    expect(psl.getDomain(host)).toBe(domain);
  });

  it('computes public suffixes', () => {
    expect(psl.getPublicSuffix('www.example.co.uk')).toBe('co.uk');
    expect(psl.getPublicSuffix('x.y.kawasaki.jp')).toBe('y.kawasaki.jp');
    expect(psl.getPublicSuffix('unknown.tld')).toBe('tld');
  });

  it('recognises IP addresses', () => {
    expect(isIpAddress('10.0.0.1')).toBe(true);
    expect(isIpAddress('[::1]')).toBe(true);
    expect(isIpAddress('example.com')).toBe(false);
  });
});
