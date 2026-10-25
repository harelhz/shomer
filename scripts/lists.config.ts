/**
 * Where each bundled filter list comes from. Mirrors are tried in order; the
 * GitHub mirrors are listed first because they are the most reliable from CI.
 */
export interface ListSource {
  format: 'abp' | 'hosts';
  /** A file in this repository… */
  file?: string;
  /** …or remote URLs (first that works wins). */
  urls?: string[];
}

export const LIST_SOURCES: Record<string, ListSource> = {
  'shomer-base': { format: 'abp', file: 'filters/shomer-base.txt' },
  easylist: {
    format: 'abp',
    urls: [
      'https://raw.githubusercontent.com/easylist/easylist/gh-pages/easylist.txt',
      'https://easylist.to/easylist/easylist.txt',
    ],
  },
  easyprivacy: {
    format: 'abp',
    urls: [
      'https://raw.githubusercontent.com/easylist/easylist/gh-pages/easyprivacy.txt',
      'https://easylist.to/easylist/easyprivacy.txt',
    ],
  },
  'ublock-filters': {
    format: 'abp',
    urls: [
      'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
      'https://ublockorigin.github.io/uAssets/filters/filters.txt',
    ],
  },
  'ublock-privacy': {
    format: 'abp',
    urls: [
      'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
      'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
    ],
  },
  'peter-lowe': {
    format: 'hosts',
    urls: [
      'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/thirdparties/pgl.yoyo.org/as/serverlist',
      'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
    ],
  },
  cookies: {
    format: 'abp',
    urls: [
      'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt',
      'https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt',
    ],
  },
};

export const PSL_URLS = [
  'https://raw.githubusercontent.com/publicsuffix/list/master/public_suffix_list.dat',
  'https://publicsuffix.org/list/public_suffix_list.dat',
];
