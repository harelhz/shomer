/**
 * Public Suffix List matcher.
 *
 * Implements the algorithm from https://publicsuffix.org/list/ — normal rules,
 * wildcard rules (`*.ck`) and exception rules (`!www.ck`) — over a plain-text
 * list. Used to compute registrable domains ("eTLD+1"), which is what both
 * Privacy-Badger-style learning and "site" scoping are keyed on.
 */
export interface PublicSuffixList {
  /** `a.b.example.co.uk` → `co.uk` */
  getPublicSuffix(hostname: string): string;
  /** `a.b.example.co.uk` → `example.co.uk`; IPs and bare suffixes are returned as-is. */
  getDomain(hostname: string): string;
}

export function createPublicSuffixList(listText: string): PublicSuffixList {
  const rules = new Set<string>();
  const wildcards = new Set<string>();
  const exceptions = new Set<string>();

  for (const rawLine of listText.split('\n')) {
    // A rule is the first whitespace-delimited token on a line.
    const line = rawLine.trim().split(/\s/, 1)[0] ?? '';
    if (line === '' || line.startsWith('//')) continue;
    const rule = line.toLowerCase();
    if (rule.startsWith('!')) exceptions.add(toAscii(rule.slice(1)));
    else if (rule.startsWith('*.')) wildcards.add(toAscii(rule.slice(2)));
    else rules.add(toAscii(rule));
  }

  function suffixStart(labels: string[]): number {
    // Walk from the longest candidate to the shortest; the first hit is the
    // longest matching rule, which is what the algorithm prescribes.
    for (let i = 0; i < labels.length; i++) {
      const candidate = labels.slice(i).join('.');
      if (exceptions.has(candidate)) return i + 1;
      if (rules.has(candidate)) return i;
      if (i + 1 < labels.length && wildcards.has(labels.slice(i + 1).join('.'))) return i;
    }
    // Implicit "*" rule: the last label is a public suffix.
    return labels.length - 1;
  }

  function normalize(hostname: string): string {
    let h = hostname.toLowerCase();
    if (h.endsWith('.')) h = h.slice(0, -1);
    return h;
  }

  return {
    getPublicSuffix(hostname) {
      const h = normalize(hostname);
      if (isIpAddress(h)) return h;
      const labels = h.split('.');
      return labels.slice(suffixStart(labels)).join('.');
    },
    getDomain(hostname) {
      const h = normalize(hostname);
      if (h === '' || isIpAddress(h)) return h;
      const labels = h.split('.');
      const start = suffixStart(labels);
      if (start === 0) return h; // the hostname is itself a public suffix
      return labels.slice(start - 1).join('.');
    },
  };
}

export function isIpAddress(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  return hostname.includes(':') || (hostname.startsWith('[') && hostname.endsWith(']'));
}

/** Punycode-encode a hostname. Works in browsers and Node (both have WHATWG URL). */
export function toAscii(hostname: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(hostname)) return hostname;
  try {
    return new URL(`http://${hostname}/`).hostname;
  } catch {
    return hostname;
  }
}
