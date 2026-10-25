/**
 * Background service worker entry point.
 *
 * MV3 rule: every event listener must be registered synchronously during the
 * first turn of the event loop, or events that wake the worker are lost.
 * State is loaded lazily by `ready()` inside the handlers.
 */
import { applyAll, applyDynamicRulesSoon } from './apply';
import { handleMessage } from './handlers';
import { setThresholdListener } from './learning';
import { ready, setLastError } from './state';
import { removeTab, restoreTabs } from './tabs';
import { installWebRequestObservers } from './web-request';

setThresholdListener(applyDynamicRulesSoon);
installWebRequestObservers();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(
    (result) => sendResponse(result),
    (error: unknown) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }),
  );
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await ready();
    await applyAll();
    setupContextMenu();
    if (details.reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('ui/onboarding.html') });
    }
  })().catch(setLastError);
});

chrome.runtime.onStartup.addListener(() => {
  void ready().then(applyAll).catch(setLastError);
});

chrome.tabs.onRemoved.addListener((tabId) => removeTab(tabId));

function setupContextMenu(): void {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'shomer-pick',
      title: 'Block element…',
      contexts: ['page', 'image', 'link', 'frame', 'video', 'audio'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
}

async function startPicker(tabId: number, zapper = false): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (mode: string) => {
      (window as unknown as { __shomerPickerMode: string }).__shomerPickerMode = mode;
    },
    args: [zapper ? 'zapper' : 'picker'],
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/picker.js'] });
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shomer-pick' && tab?.id !== undefined) void startPicker(tab.id).catch(setLastError);
});

chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === 'open-picker' && tab?.id !== undefined) void startPicker(tab.id).catch(setLastError);
});

void restoreTabs();
