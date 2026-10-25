/**
 * Build-time metadata about the bundled rulesets, and enabling/disabling the
 * corresponding static DNR rulesets.
 */
import { RULESETS } from '../shared/constants';
import { enabledRulesetIds, type Settings } from '../shared/settings';

export interface ListMeta {
  network: number;
  rules: number;
  cosmetic: number;
  scriptlets: number;
  unsupported: number;
}

export interface BuildMeta {
  version: string;
  builtAt: string;
  lists: Record<string, ListMeta>;
  /** list id → registered scriptlet file and the hostnames it applies to. */
  scriptlets: Record<string, { file: string; matches: string[] }>;
  /** list ids that ship a cosmetic bundle. */
  cosmetic: string[];
}

let metaPromise: Promise<BuildMeta> | null = null;

export function buildMeta(): Promise<BuildMeta> {
  metaPromise ??= fetch(chrome.runtime.getURL('rulesets/meta.json'))
    .then((r) => r.json() as Promise<BuildMeta>)
    .catch(() => ({ version: __VERSION__, builtAt: __BUILD_TIME__, lists: {}, scriptlets: {}, cosmetic: [] }));
  return metaPromise;
}

export async function applyStaticRulesets(settings: Settings): Promise<void> {
  const want = new Set(enabledRulesetIds(settings));
  const current = new Set(await chrome.declarativeNetRequest.getEnabledRulesets());
  const enableRulesetIds = RULESETS.map((r) => r.id).filter((id) => want.has(id) && !current.has(id));
  const disableRulesetIds = [...current].filter((id) => !want.has(id));
  if (enableRulesetIds.length === 0 && disableRulesetIds.length === 0) return;
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
}
