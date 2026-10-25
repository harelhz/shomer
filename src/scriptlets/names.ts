/**
 * Scriptlet names and aliases understood by Shomer. Names follow uBlock
 * Origin's so that its filter lists can be used as-is.
 */
const ALIASES: Record<string, string[]> = {
  'set-constant': ['set', 'trusted-set-constant', 'trusted-set'],
  'abort-on-property-read': ['aopr'],
  'abort-on-property-write': ['aopw'],
  'abort-current-script': ['acs', 'abort-current-inline-script', 'acis'],
  'abort-on-stack-trace': ['aost'],
  'prevent-addEventListener': ['aeld', 'addEventListener-defuser'],
  'prevent-setTimeout': ['nostif', 'no-setTimeout-if', 'setTimeout-defuser'],
  'prevent-setInterval': ['nosiif', 'no-setInterval-if', 'setInterval-defuser'],
  'adjust-setTimeout': ['nano-stb', 'nano-setTimeout-booster'],
  'adjust-setInterval': ['nano-sib', 'nano-setInterval-booster'],
  'prevent-window-open': ['nowoif', 'no-window-open-if', 'window.open-defuser'],
  'set-cookie': [],
  'set-cookie-reload': [],
  'trusted-set-cookie': [],
  'trusted-set-cookie-reload': [],
  'set-local-storage-item': [],
  'trusted-set-local-storage-item': [],
  'set-session-storage-item': [],
  'trusted-set-session-storage-item': [],
  'trusted-click-element': [],
  'remove-attr': ['ra'],
  'remove-class': ['rc'],
  'remove-node-text': ['rmnt'],
  'set-attr': [],
  'prevent-eval': ['noeval', 'noeval-if', 'prevent-eval-if', 'silent-noeval'],
  'prevent-fetch': ['no-fetch-if', 'trusted-prevent-fetch'],
  'prevent-xhr': ['no-xhr-if', 'trusted-prevent-xhr'],
  'json-prune': [],
  nowebrtc: [],
  'refresh-defuser': [],
  'cookie-remover': ['remove-cookie'],
  'replace-node-text': ['rpnt', 'trusted-replace-node-text'],
  'href-sanitizer': [],
  'prevent-requestAnimationFrame': ['norafif', 'no-requestAnimationFrame-if'],
  'fuckadblock-defuser': ['nofab'],
  'disable-newtab-links': [],
};

const CANONICAL = new Map<string, string>();
for (const [name, aliases] of Object.entries(ALIASES)) {
  CANONICAL.set(name, name);
  for (const a of aliases) CANONICAL.set(a, name);
}

export const SCRIPTLET_NAMES = Object.keys(ALIASES);

/** `aopr.js` → `abort-on-property-read`; null if unsupported. */
export function canonicalScriptletName(name: string): string | null {
  return CANONICAL.get(name.replace(/\.js$/, '')) ?? null;
}
