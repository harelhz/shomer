/**
 * Toolbar badge. Chrome counts DNR matches itself (setExtensionActionOptions);
 * Firefox doesn't implement that, so there we maintain the count by hand.
 */
import { getTab } from './tabs';
import { state } from './state';

const pending = new Set<number>();

export function updateBadgeSoon(tabId: number): void {
  if (__BROWSER__ !== 'firefox' || pending.has(tabId)) return;
  pending.add(tabId);
  setTimeout(() => {
    pending.delete(tabId);
    const count = getTab(tabId)?.blocked ?? 0;
    const text = state.settings.badge && count > 0 ? String(count > 999 ? '999+' : count) : '';
    void chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  }, 250);
}
