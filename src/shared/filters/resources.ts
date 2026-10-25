/**
 * Redirect resources ("surrogates").
 *
 * `$redirect=` filters replace a blocked resource with a harmless stand-in so
 * that pages which depend on it keep working. Names follow uBlock Origin's
 * conventions (including aliases) so third-party lists work unmodified; the
 * files themselves are Shomer's own implementations in
 * src/resources/web_accessible_resources.
 */
const RESOURCE_FILES: Record<string, string> = {
  'noop.js': 'noop.js',
  noopjs: 'noop.js',
  'blank-js': 'noop.js',
  'noop.css': 'noop.css',
  noopcss: 'noop.css',
  'noop.txt': 'noop.txt',
  nooptext: 'noop.txt',
  empty: 'noop.txt',
  'blank-text': 'noop.txt',
  'noop.html': 'noop.html',
  noopframe: 'noop.html',
  'blank-html': 'noop.html',
  'noop.json': 'noop.json',
  noopjson: 'noop.json',
  '1x1.gif': '1x1.gif',
  '1x1-transparent.gif': '1x1.gif',
  '1x1-transparent-gif': '1x1.gif',
  '2x2.png': '2x2.png',
  '2x2-transparent.png': '2x2.png',
  '2x2-transparent-png': '2x2.png',
  '3x2.png': '2x2.png',
  '3x2-transparent.png': '2x2.png',
  '32x32.png': '2x2.png',
  '32x32-transparent.png': '2x2.png',
  'noop-vmap1.0.xml': 'noop-vmap1.xml',
  'noopvmap-1.0': 'noop-vmap1.xml',
  'google-analytics_analytics.js': 'google-analytics.js',
  'google-analytics.com/analytics.js': 'google-analytics.js',
  'googletagmanager_gtm.js': 'google-analytics.js',
  'googletagmanager.com/gtm.js': 'google-analytics.js',
  'google-analytics_ga.js': 'google-analytics.js',
  'google-analytics.com/ga.js': 'google-analytics.js',
  'googletagservices_gpt.js': 'googletagservices-gpt.js',
  'googletagservices.com/gpt.js': 'googletagservices-gpt.js',
  'googlesyndication_adsbygoogle.js': 'adsbygoogle.js',
  'googlesyndication.com/adsbygoogle.js': 'adsbygoogle.js',
  'amazon_apstag.js': 'amazon-apstag.js',
  'amazon-adsystem.com/aax2/amzn_ads.js': 'amazon-apstag.js',
};

export const RESOURCES_DIR = 'web_accessible_resources';

/** Maps a uBO redirect token to an extension path, or null if we don't ship it. */
export function resolveRedirectResource(token: string): string | null {
  const file = RESOURCE_FILES[token];
  return file ? `/${RESOURCES_DIR}/${file}` : null;
}

export const RESOURCE_FILE_NAMES = [...new Set(Object.values(RESOURCE_FILES))];
