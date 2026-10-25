/**
 * Glue between the network observers and the tracker-learning heuristic.
 */
import { isModuleActive, type TrackerAction } from '../shared/settings';
import { learnedAction, recordTracking, type TrackingSignal } from './tracker-logic';
import { saveStatsSoon, saveTrackersSoon, state } from './state';
import { markTracking } from './tabs';

let onThresholdCrossed: () => void = () => {};

export function setThresholdListener(fn: () => void): void {
  onThresholdCrossed = fn;
}

export function noteTracking(tabId: number, trackerBase: string, site: string, signal: TrackingSignal): void {
  markTracking(tabId, trackerBase);
  const { settings } = state;
  if (!settings.learning || !isModuleActive(settings, site, 'trackers')) return;
  const result = recordTracking(state.trackers, trackerBase, site, signal, settings.learningThreshold);
  if (!result.changed) return;
  saveTrackersSoon();
  if (result.crossedThreshold) {
    state.stats.learned++;
    saveStatsSoon();
    onThresholdCrossed();
  }
}

/** Learned trackers that should be acted upon, minus explicit user choices. */
export function learnedRulesInput(): { domain: string; action: Exclude<TrackerAction, 'allow'> }[] {
  const { settings, trackers } = state;
  const out: { domain: string; action: Exclude<TrackerAction, 'allow'> }[] = [];
  for (const [domain, record] of Object.entries(trackers)) {
    if (settings.trackerOverrides[domain]) continue;
    const action = learnedAction(domain, record, settings.learningThreshold);
    if (action === 'block' || action === 'cookieblock') out.push({ domain, action });
  }
  return out;
}

export function effectiveAction(domain: string): {
  action: TrackerAction | 'none';
  source: 'user' | 'learned' | 'none';
} {
  const override = state.settings.trackerOverrides[domain];
  if (override) return { action: override, source: 'user' };
  const learned = learnedAction(domain, state.trackers[domain], state.settings.learningThreshold);
  return learned === 'none' ? { action: 'none', source: 'none' } : { action: learned, source: 'learned' };
}
