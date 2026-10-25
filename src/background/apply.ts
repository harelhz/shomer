/**
 * Pushes the current state into the browser: static rulesets, dynamic rules,
 * registered scripts, the WebRTC policy and the badge. Every step is
 * idempotent; the whole sequence is serialised.
 */
import { PRIORITY } from '../shared/constants';
import { compileFilterList, type CompiledList } from '../shared/filters/compiler';
import type { DnrRuleDraft } from '../shared/dnr-types';
import { createSerialQueue, debounce } from '../shared/util';
import { invalidateCosmetics, setCustomCosmetics } from './cosmetics';
import { buildDynamicRules } from './dynamic-rules';
import { learnedRulesInput } from './learning';
import { applyStaticRulesets } from './rulesets';
import { syncScripts } from './scripts';
import { setLastError, state } from './state';

const serial = createSerialQueue();

let compiledFilters: { text: string; result: CompiledList } | null = null;

export function compileCustomFilters(text: string): CompiledList {
  if (compiledFilters?.text === text) return compiledFilters.result;
  const result = compileFilterList(text, {
    priorityOffset: PRIORITY.CUSTOM_OFFSET,
    collectUnsupported: true,
    allowScriptlets: false,
  });
  compiledFilters = { text, result };
  return result;
}

export let dynamicRuleCount = 0;

async function applyDynamicRules(customRules: DnrRuleDraft[]): Promise<void> {
  const { rules, dropped } = buildDynamicRules({ settings: state.settings, learned: learnedRulesInput(), customRules });
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules as chrome.declarativeNetRequest.Rule[],
  });
  dynamicRuleCount = rules.length;
  if (dropped > 0) setLastError(`${dropped} rules were dropped because of browser rule limits.`);
}

async function applyWebRtcPolicy(enabled: boolean): Promise<void> {
  const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy;
  if (!setting) return;
  try {
    if (enabled) await setting.set({ value: 'default_public_interface_only' });
    else await setting.clear({});
  } catch {
    /* controlled by policy or another extension */
  }
}

async function applyBadge(enabled: boolean): Promise<void> {
  try {
    await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: enabled });
    await chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });
  } catch {
    /* not supported */
  }
}

export function applyAll(): Promise<void> {
  return serial(async () => {
    const { settings } = state;
    const custom = compileCustomFilters(settings.customFilters);
    setCustomCosmetics(custom.cosmetic);
    invalidateCosmetics();
    const steps: [string, () => Promise<void>][] = [
      ['rulesets', () => applyStaticRulesets(settings)],
      ['dynamic rules', () => applyDynamicRules(custom.rules)],
      ['scripts', () => syncScripts(settings)],
      ['webrtc', () => applyWebRtcPolicy(settings.webrtcProtection)],
      ['badge', () => applyBadge(settings.badge)],
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (error) {
        setLastError(`Applying ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
}

/** Learned trackers change often; batch their rule updates. */
export const applyDynamicRulesSoon = debounce(() => {
  void serial(() => applyDynamicRules(compileCustomFilters(state.settings.customFilters).rules)).catch(setLastError);
}, 2000);
