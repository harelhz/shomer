/**
 * Isolated-world content script, injected into every frame at document_start.
 *
 * It asks the background what applies to this frame (the background injects
 * the cosmetic CSS itself), then starts the parts that need the DOM:
 * generic-token reporting, procedural filters and the cookie-banner engine.
 * It also relays fingerprinting reports from the MAIN-world shield.
 */
import { FP_EVENT } from '../shared/constants';
import { sendMessage } from '../shared/messages';
import { startCookieEngine } from './cookies';
import { startProcedural } from './procedural';
import { startTokenCollector } from './tokens';

declare global {
  interface Window {
    __shomerContent?: boolean;
  }
}

function relayFingerprintReports(): void {
  let sent = 0;
  document.addEventListener(
    FP_EVENT,
    (event) => {
      event.stopImmediatePropagation();
      if (sent++ > 50) return; // a page can't flood the background
      try {
        const { api, script } = JSON.parse(String((event as CustomEvent).detail)) as { api: string; script: string };
        void sendMessage('content:fp', { api: String(api), script: String(script) }).catch(() => {});
      } catch {
        /* malformed */
      }
    },
    true,
  );
}

async function init(): Promise<void> {
  let config;
  try {
    config = await sendMessage('content:init', { url: location.href });
  } catch {
    return; // extension reloaded or context invalidated
  }
  if (!config?.active) return;
  if (config.cosmetic && config.generic) {
    startTokenCollector((tokens) => void sendMessage('content:tokens', { tokens }).catch(() => {}));
  }
  if (config.procedural.length > 0) startProcedural(config.procedural);
  if (config.cookies) {
    startCookieEngine(config.cookies.mode, (cmp, action) => {
      void sendMessage('content:cookie', { cmp, action }).catch(() => {});
    });
  }
}

if (!window.__shomerContent) {
  window.__shomerContent = true;
  relayFingerprintReports();
  void init();
}
