/**
 * Toolbar popup: protection status for the current site, per-site module
 * switches, and the third parties contacted by the page with a
 * Block / Cookies / Allow choice for each (Privacy Badger-style).
 */
import { REPO_URL, type ModuleId } from '../../shared/constants';
import { sendMessage, type PopupData, type ThirdPartyInfo } from '../../shared/messages';
import type { TrackerAction } from '../../shared/settings';
import { $, formatNumber, h, segmented, toggle } from '../shared/dom';

const MODULES: { id: ModuleId; name: string; description: string }[] = [
  { id: 'adblock', name: 'Ads & content blocking', description: 'Filter lists, element hiding, scriptlets' },
  { id: 'trackers', name: 'Tracker learning', description: 'Blocks trackers seen across sites' },
  { id: 'fingerprint', name: 'Fingerprint shield', description: 'Canvas, WebGL and audio noise' },
  { id: 'cookies', name: 'Cookie banners', description: 'Rejects or hides consent pop-ups' },
];

const FP_LABELS: Record<string, string> = {
  canvas: 'canvas',
  'canvas-text': 'canvas text',
  'webgl-readpixels': 'WebGL',
  'webgl-renderer': 'GPU info',
  audio: 'audio',
  'font-metrics': 'fonts',
};

const app = $('#app');
let tabId = -1;
let needsReload = false;

function powerIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  for (const [k, v] of Object.entries({
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.4',
    'stroke-linecap': 'round',
    d: 'M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0',
  })) {
    path.setAttribute(k, v);
  }
  svg.append(path);
  return svg;
}

function changed(): void {
  needsReload = true;
  void render();
}

function stat(value: string, label: string, title?: string): HTMLElement {
  return h('div', { class: 'stat', title }, h('b', {}, value), h('span', {}, label));
}

function statusPill(tp: ThirdPartyInfo, threshold: number): HTMLElement {
  if (tp.action === 'block')
    return h('span', { class: 'pill bad' }, tp.source === 'list' ? 'Blocked by list' : 'Blocked');
  if (tp.action === 'cookieblock') return h('span', { class: 'pill warn' }, 'Cookies blocked');
  if (tp.action === 'allow' && tp.source === 'user') return h('span', { class: 'pill good' }, 'Allowed');
  if (tp.tracking) return h('span', { class: 'pill warn' }, `Tracking · ${tp.sites}/${threshold} sites`);
  return h('span', { class: 'pill' }, 'Not tracking');
}

function thirdPartyRow(tp: ThirdPartyInfo, threshold: number): HTMLElement {
  const current: TrackerAction | null = tp.source === 'user' ? (tp.action as TrackerAction) : null;
  const control = segmented<TrackerAction>(
    [
      { value: 'block', label: 'Block', title: 'Block all requests to this domain' },
      { value: 'cookieblock', label: 'Cookies', title: 'Allow requests but strip cookies' },
      { value: 'allow', label: 'Allow', title: 'Never block this domain' },
    ],
    current ?? (tp.action === 'none' ? null : tp.action),
    async (action) => {
      // Choosing the action Shomer would take anyway clears the override.
      const automatic = tp.source !== 'user' && action === tp.action;
      await sendMessage('tracker:set', { domain: tp.domain, action: automatic ? null : action });
      changed();
    },
    `Action for ${tp.domain}`,
  );
  return h(
    'div',
    { class: 'row' },
    h(
      'div',
      { class: 'label' },
      h('span', { class: 'domain', title: tp.domain }, tp.domain),
      h('small', {}, statusPill(tp, threshold)),
    ),
    control,
  );
}

function view(data: PopupData): HTMLElement[] {
  if (!data.supported) {
    return [
      h(
        'p',
        { class: 'muted center' },
        'Shomer doesn’t run on this page. Open a website to see its protection status.',
      ),
    ];
  }

  const enabled = !data.allowlisted;
  const power = h('button', {
    class: `power${enabled ? '' : ' off'}`,
    title: enabled ? 'Disable Shomer on this site' : 'Enable Shomer on this site',
    'aria-label': enabled ? 'Disable Shomer on this site' : 'Enable Shomer on this site',
    'aria-pressed': String(enabled),
  });
  power.append(powerIcon());
  power.addEventListener('click', async () => {
    await sendMessage('site:allowlist', { site: data.site, value: enabled });
    changed();
  });

  const site = h(
    'section',
    { class: 'site' },
    h(
      'div',
      {},
      h('div', { class: 'site-name' }, data.site || data.hostname),
      h('div', { class: `status${enabled ? '' : ' off'}` }, enabled ? 'Protected' : 'Protection is off for this site'),
    ),
    power,
  );

  const trackerCount = data.thirdParties.filter(
    (t) => t.tracking || t.action === 'block' || t.action === 'cookieblock',
  ).length;
  const cookie = data.stats.cookie;
  const stats = h(
    'section',
    { class: 'stats', 'aria-label': 'Statistics for this page' },
    stat(formatNumber(data.stats.blocked), 'requests blocked'),
    stat(`${trackerCount}/${data.thirdParties.length}`, 'third parties tracking'),
    stat(
      formatNumber(data.stats.fingerprint),
      'fingerprint attempts',
      data.fingerprintApis.map((a) => FP_LABELS[a] ?? a).join(', ') || undefined,
    ),
    stat(cookie ? (cookie.action === 'rejected' ? 'Rejected' : 'Hidden') : '—', cookie ? cookie.cmp : 'cookie banner'),
  );

  const modules = h(
    'section',
    { class: 'section' },
    h('h2', {}, 'On this site'),
    h(
      'div',
      { class: 'card' },
      ...MODULES.map((m) => {
        const state = data.modules[m.id];
        const description = state.global ? m.description : 'Turned off in the dashboard';
        return h(
          'div',
          { class: 'row' },
          h('div', { class: 'label' }, h('span', {}, m.name), h('small', {}, description)),
          toggle(
            state.global && state.site && enabled,
            async (value) => {
              await sendMessage('site:module', { site: data.site, module: m.id, value });
              changed();
            },
            `${m.name} on ${data.site}`,
            !state.global || !enabled,
          ),
        );
      }),
    ),
  );

  const trackers = h(
    'section',
    { class: 'section' },
    h('h2', {}, `Third parties on this page (${data.thirdParties.length})`),
    h(
      'div',
      { class: 'card trackers' },
      ...(data.thirdParties.length > 0
        ? data.thirdParties.map((tp) => thirdPartyRow(tp, data.threshold))
        : [
            h(
              'div',
              { class: 'empty' },
              'No third-party requests seen. Reload the page if it was open before Shomer started.',
            ),
          ]),
    ),
  );

  const actions = h(
    'section',
    { class: 'actions' },
    h(
      'button',
      { class: 'btn', onclick: () => startPicker(false), title: 'Hide an element permanently' },
      'Block element',
    ),
    h(
      'button',
      { class: 'btn', onclick: () => startPicker(true), title: 'Remove elements until reload' },
      'Zap element',
    ),
    h(
      'button',
      {
        class: 'btn',
        title: 'Report a site that doesn’t work with Shomer',
        onclick: () => {
          const title = encodeURIComponent(`Broken site: ${data.hostname}`);
          void chrome.tabs.create({ url: `${REPO_URL}/issues/new?template=broken_site.yml&title=${title}` });
        },
      },
      'Report issue',
    ),
  );

  const out: HTMLElement[] = [];
  if (needsReload) {
    out.push(
      h(
        'div',
        { class: 'reload', role: 'status' },
        'Reload the page to apply your changes.',
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              void chrome.tabs.reload(tabId);
              window.close();
            },
          },
          'Reload',
        ),
      ),
    );
  }
  out.push(site, stats, modules, trackers, actions);
  return out;
}

async function startPicker(zapper: boolean): Promise<void> {
  await sendMessage('picker:start', { tabId, zapper });
  window.close();
}

async function render(): Promise<void> {
  const data = await sendMessage('popup:get', { tabId });
  if (!data) {
    app.replaceChildren(h('p', { class: 'muted center' }, 'No page information available.'));
    return;
  }
  app.replaceChildren(...view(data));
}

async function main(): Promise<void> {
  $('#open-dashboard').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });
  // `?tabId=` lets automated tests open the popup as a page for a given tab.
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced > 0) {
    tabId = forced;
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? -1;
  }
  await render();
}

void main().catch((error: unknown) => {
  app.replaceChildren(h('p', { class: 'muted center' }, `Something went wrong: ${String(error)}`));
});
