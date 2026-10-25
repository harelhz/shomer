/**
 * Persistent state: settings, learned trackers and lifetime statistics.
 *
 * MV3 service workers are killed when idle, so everything lives in
 * chrome.storage and is reloaded on wake-up. Writes of high-churn data
 * (trackers, stats) are debounced.
 */
import type { GlobalStats } from '../shared/messages';
import { createPublicSuffixList } from '../shared/psl';
import { sanitizeSettings, type Settings } from '../shared/settings';
import { debounce } from '../shared/util';
import { PSL_TEXT } from '../generated/psl';
import { pruneDb, sanitizeTrackerDb, type TrackerDb } from './tracker-logic';

export const psl = createPublicSuffixList(PSL_TEXT);

export const state = {
  settings: sanitizeSettings(undefined),
  trackers: {} as TrackerDb,
  stats: { since: Date.now(), blocked: 0, fingerprint: 0, cookies: 0, learned: 0 } as GlobalStats,
  lastError: null as string | null,
};

let loading: Promise<void> | null = null;

export function ready(): Promise<void> {
  loading ??= (async () => {
    const stored = await chrome.storage.local.get(['settings', 'trackers', 'stats']);
    state.settings = sanitizeSettings(stored.settings);
    state.trackers = sanitizeTrackerDb(stored.trackers);
    if (stored.stats && typeof stored.stats === 'object')
      state.stats = { ...state.stats, ...(stored.stats as GlobalStats) };
  })();
  return loading;
}

export async function saveSettings(next: Settings): Promise<Settings> {
  state.settings = sanitizeSettings(next);
  await chrome.storage.local.set({ settings: state.settings });
  return state.settings;
}

export const saveTrackersSoon = debounce(() => {
  pruneDb(state.trackers, state.settings.learningThreshold);
  void chrome.storage.local.set({ trackers: state.trackers });
}, 3000);

export const saveStatsSoon = debounce(() => {
  void chrome.storage.local.set({ stats: state.stats });
}, 5000);

export function setLastError(error: unknown): void {
  state.lastError = error instanceof Error ? error.message : String(error);
  console.warn('[Shomer]', state.lastError);
}
