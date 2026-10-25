/**
 * Scriptlet runtime, injected into the MAIN world at document_start.
 *
 * The build produces one copy of this file per filter list, with that list's
 * scriptlet table substituted for `__SCRIPTLET_DATA__`. The background
 * registers each copy only on the hostnames that appear in its table.
 */
import type { ScriptletBundle } from '../shared/filters/cosmetic';
import { SCRIPTLETS } from './library';

declare const __SCRIPTLET_DATA__: ScriptletBundle;

/** Hostname keys without a public suffix list: parents plus every `label.*` entity. */
export function scriptletKeys(hostname: string): string[] {
  const labels = hostname.split('.');
  const keys: string[] = [];
  for (let i = 0; i < labels.length; i++) keys.push(labels.slice(i).join('.'));
  for (let i = 0; i < labels.length - 1; i++) {
    for (let j = i + 1; j < labels.length; j++) keys.push(`${labels.slice(i, j).join('.')}.*`);
  }
  return keys;
}

export function selectInvocations(data: ScriptletBundle, hostname: string): string[][] {
  const keys = scriptletKeys(hostname);
  const exceptions = new Set<string>();
  for (const k of keys) for (const e of data.exceptions[k] ?? []) exceptions.add(e);
  if (exceptions.has('*')) return [];
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const k of keys) {
    for (const invocation of data.entries[k] ?? []) {
      const key = JSON.stringify(invocation);
      if (exceptions.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(invocation);
    }
  }
  return out;
}

function main(): void {
  let hostname = location.hostname;
  // about:blank / srcdoc frames inherit their parent's origin.
  if (hostname === '') {
    try {
      hostname = new URL(location.ancestorOrigins?.[0] ?? document.referrer).hostname;
    } catch {
      return;
    }
  }
  for (const [name, ...args] of selectInvocations(__SCRIPTLET_DATA__, hostname)) {
    const fn = name ? SCRIPTLETS[name] : undefined;
    if (!fn) continue;
    try {
      fn(...args);
    } catch {
      /* one broken scriptlet must not stop the others */
    }
  }
}

if (typeof __SCRIPTLET_DATA__ !== 'undefined') main();
