/**
 * Dashboard (options page). Hash-routed sections, each rendered from fresh
 * data from the background.
 */
import { REPO_URL, type ModuleId } from '../../shared/constants';
import { sendMessage, type OverviewData, type TrackerListItem } from '../../shared/messages';
import { isValidDomain, type Settings, type TrackerAction } from '../../shared/settings';
import { $, formatNumber, h, segmented, toast, toggle } from '../shared/dom';

const content = $('#content');

const MODULE_INFO: Record<ModuleId, { name: string; description: string }> = {
  adblock: {
    name: 'Ads & content blocking',
    description:
      'Blocks ads and known trackers with filter lists, hides leftover ad elements, and defuses anti-adblock scripts.',
  },
  trackers: {
    name: 'Tracker learning',
    description:
      'Watches third parties that set identifying cookies or fingerprint you, and blocks them once seen on several sites.',
  },
  fingerprint: {
    name: 'Fingerprint shield',
    description:
      'Adds invisible, per-page noise to canvas, WebGL and audio readouts so they can’t be used to identify you.',
  },
  cookies: {
    name: 'Cookie banners',
    description: 'Clicks “reject” on consent pop-ups where possible, and hides the rest.',
  },
};

function header(title: string, lead: string): HTMLElement[] {
  return [h('h1', {}, title), h('p', { class: 'lead' }, lead)];
}

function setting(name: string, description: string, control: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'setting' },
    h('div', { class: 'text' }, h('b', {}, name), h('small', {}, description)),
    control,
  );
}

async function update(patch: Partial<Settings>): Promise<Settings> {
  const next = await sendMessage('settings:update', { patch });
  toast('Saved');
  return next;
}

function select<T extends string>(
  value: T,
  options: [T, string][],
  onChange: (v: T) => void,
  label: string,
): HTMLSelectElement {
  const el = h(
    'select',
    { 'aria-label': label },
    ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)),
  );
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

/* -------------------------------------------------------------------------- */

async function overview(): Promise<HTMLElement[]> {
  const data: OverviewData = await sendMessage('overview:get', {});
  const since = new Date(data.stats.since).toLocaleDateString();
  const activeLists = data.rulesets.filter((r) => r.active);
  const staticRules = activeLists.reduce((a, r) => a + r.rules, 0);
  const out = [
    ...header('Overview', `What Shomer has done for you since ${since}.`),
    h(
      'div',
      { class: 'grid' },
      tile(formatNumber(data.stats.blocked), 'requests blocked'),
      tile(formatNumber(data.blockedTrackers), 'trackers learned & blocked'),
      tile(formatNumber(data.stats.fingerprint), 'fingerprinting attempts'),
      tile(formatNumber(data.stats.cookies), 'cookie banners handled'),
    ),
    h('h2', {}, 'Engine'),
    h(
      'div',
      { class: 'grid' },
      tile(formatNumber(staticRules), `static rules in ${activeLists.length} lists`),
      tile(formatNumber(data.dynamicRules), 'dynamic rules'),
      tile(formatNumber(data.learnedTrackers), 'third parties observed tracking'),
      tile(
        data.availableStaticRules === null ? '—' : formatNumber(data.availableStaticRules),
        'static rule quota left',
      ),
    ),
  ];
  if (data.lastError) out.push(h('p', { class: 'notice' }, `Last problem: ${data.lastError}`));
  return out;
}

function tile(value: string, label: string): HTMLElement {
  return h('div', { class: 'tile' }, h('b', {}, value), h('span', {}, label));
}

/* -------------------------------------------------------------------------- */

async function protection(): Promise<HTMLElement[]> {
  let s = await sendMessage('settings:get', {});
  // Each change is computed from the latest saved settings, not the ones we rendered with.
  const set = async (patch: (current: Settings) => Partial<Settings>) => {
    s = await update(patch(s));
  };
  const modules = h(
    'div',
    { class: 'panel' },
    ...(Object.keys(MODULE_INFO) as ModuleId[]).map((m) =>
      setting(
        MODULE_INFO[m].name,
        MODULE_INFO[m].description,
        toggle(s.modules[m], (v) => void set((c) => ({ modules: { ...c.modules, [m]: v } })), MODULE_INFO[m].name),
      ),
    ),
  );
  const details = h(
    'div',
    { class: 'panel' },
    setting(
      'Fingerprint protection level',
      'Strict also protects against font and DOM-measurement fingerprinting and reports a generic GPU. It may affect a few sites.',
      select(
        s.fingerprintLevel,
        [
          ['standard', 'Standard'],
          ['strict', 'Strict'],
        ],
        (v) => void set(() => ({ fingerprintLevel: v })),
        'Fingerprint protection level',
      ),
    ),
    setting(
      'Cookie banner handling',
      '“Reject” clicks the refuse button when there is one; “Hide” only hides banners. Shomer never accepts on your behalf.',
      select(
        s.cookieMode,
        [
          ['reject', 'Reject, then hide'],
          ['hide', 'Hide only'],
        ],
        (v) => void set(() => ({ cookieMode: v })),
        'Cookie banner handling',
      ),
    ),
    setting(
      'Learn trackers while browsing',
      'Privacy Badger-style local learning. Learned blocks are stored only on this device.',
      toggle(s.learning, (v) => void set(() => ({ learning: v })), 'Learn trackers'),
    ),
    setting(
      'Learning threshold',
      'How many different sites a third party must track you on before it is blocked.',
      select(
        String(s.learningThreshold) as '2' | '3' | '4' | '5',
        [
          ['2', '2 sites'],
          ['3', '3 sites (default)'],
          ['4', '4 sites'],
          ['5', '5 sites'],
        ],
        (v) => void set(() => ({ learningThreshold: Number(v) })),
        'Learning threshold',
      ),
    ),
    setting(
      'Global Privacy Control',
      'Send Sec-GPC and DNT signals: a legal opt-out of data sale under laws such as the CCPA.',
      toggle(
        s.rulesets['privacy-headers'] ?? true,
        (v) => void set((c) => ({ rulesets: { ...c.rulesets, 'privacy-headers': v } })),
        'Global Privacy Control',
      ),
    ),
    setting(
      'Clean URLs',
      'Remove tracking parameters (utm_*, fbclid, gclid…) from links you open.',
      toggle(
        s.rulesets['url-cleaning'] ?? true,
        (v) => void set((c) => ({ rulesets: { ...c.rulesets, 'url-cleaning': v } })),
        'Clean URLs',
      ),
    ),
    setting(
      'Prevent WebRTC IP leaks',
      'Stop sites from discovering your local network address through WebRTC.',
      toggle(s.webrtcProtection, (v) => void set(() => ({ webrtcProtection: v })), 'Prevent WebRTC IP leaks'),
    ),
    setting(
      'Blocked-request count on icon',
      'Show how many requests were blocked on the current page.',
      toggle(s.badge, (v) => void set(() => ({ badge: v })), 'Badge'),
    ),
  );
  return [
    ...header('Protection', 'Turn protections on or off everywhere. Per-site switches are in the toolbar popup.'),
    modules,
    h('h2', {}, 'Details'),
    details,
  ];
}

/* -------------------------------------------------------------------------- */

async function lists(): Promise<HTMLElement[]> {
  const data = await sendMessage('overview:get', {});
  let settings = await sendMessage('settings:get', {});
  const rows = data.rulesets
    .filter((r) => r.module !== 'privacy')
    .map((r) =>
      h(
        'tr',
        {},
        h(
          'td',
          {},
          h('b', {}, r.name),
          h('br'),
          h('small', { class: 'muted' }, r.description),
          r.homepage
            ? h('small', {}, ' ', h('a', { href: r.homepage, target: '_blank', rel: 'noopener' }, 'Website'))
            : null,
        ),
        h('td', { class: 'num' }, formatNumber(r.network)),
        h('td', { class: 'num' }, formatNumber(r.cosmetic)),
        h('td', { class: 'num' }, formatNumber(r.scriptlets)),
        h(
          'td',
          { class: 'num', title: 'Filters that cannot be expressed in Manifest V3' },
          formatNumber(r.unsupported),
        ),
        h(
          'td',
          {},
          toggle(
            r.enabled,
            (v) => void update({ rulesets: { ...settings.rulesets, [r.id]: v } }).then((next) => (settings = next)),
            `Enable ${r.name}`,
          ),
        ),
      ),
    );
  return [
    ...header(
      'Filter lists',
      `Lists are compiled into the extension when it is built (${new Date(data.builtAt).toLocaleString()}).`,
    ),
    h(
      'p',
      { class: 'notice' },
      'Manifest V3 doesn’t let extensions load new network rules from the internet, so lists are updated together with Shomer itself. “My filters” can be changed at any time.',
    ),
    h(
      'div',
      { class: 'panel' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h('tr', {}, ...['List', 'Network', 'Cosmetic', 'Scriptlets', 'Unsupported', 'On'].map((t) => h('th', {}, t))),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
  ];
}

/* -------------------------------------------------------------------------- */

async function filters(): Promise<HTMLElement[]> {
  const settings = await sendMessage('settings:get', {});
  const editor = h('textarea', {
    spellcheck: false,
    'aria-label': 'My filters',
    placeholder:
      '! One filter per line, in Adblock Plus / uBlock Origin syntax\n||ads.example.com^\nexample.com##.sponsored\n@@||cdn.example.com^$script',
  });
  editor.value = settings.customFilters;
  const report = h('div', { class: 'errors', 'aria-live': 'polite' });
  const save = h('button', { class: 'btn primary' }, 'Apply changes');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const result = await sendMessage('filters:set', { text: editor.value });
      report.replaceChildren(
        h('p', {}, `${result.rules} network rules and ${result.cosmetic} cosmetic filters active.`),
        ...(result.errors.length > 0
          ? [
              h('p', { class: 'notice' }, `${result.errors.length} line(s) could not be used:`),
              h(
                'ul',
                {},
                ...result.errors.map((e) =>
                  h('li', {}, h('span', { class: 'mono' }, `${e.line}: ${e.text}`), ` — ${e.reason}`),
                ),
              ),
            ]
          : []),
      );
      toast('Filters applied');
    } finally {
      save.disabled = false;
    }
  });
  return [
    ...header(
      'My filters',
      'Your own rules, applied on top of the filter lists. Elements you block with the picker are added here.',
    ),
    editor,
    h(
      'div',
      { class: 'toolbar' },
      save,
      h(
        'a',
        { href: `${REPO_URL}/blob/main/docs/FILTER_SYNTAX.md`, target: '_blank', rel: 'noopener' },
        'Filter syntax',
      ),
    ),
    report,
  ];
}

/* -------------------------------------------------------------------------- */

async function trackers(): Promise<HTMLElement[]> {
  const items = await sendMessage('trackers:list', {});
  const search = h('input', { type: 'search', placeholder: 'Filter domains…', 'aria-label': 'Filter domains' });
  const tbody = h('tbody');

  const label = (t: TrackerListItem) => {
    const action = t.override ?? t.learnedAction;
    if (action === 'block') return h('span', { class: 'pill bad' }, t.override ? 'Blocked (you)' : 'Blocked');
    if (action === 'cookieblock')
      return h('span', { class: 'pill warn' }, t.override ? 'Cookies blocked (you)' : 'Cookies blocked');
    if (action === 'allow') return h('span', { class: 'pill good' }, 'Allowed (you)');
    return h('span', { class: 'pill' }, 'Watching');
  };

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = items
      .filter((t) => t.domain.includes(q))
      .slice(0, 500)
      .map((t) =>
        h(
          'tr',
          {},
          h('td', { class: 'mono' }, t.domain),
          h('td', { class: 'num', title: t.sites.join('\n') }, String(t.sites.length)),
          h(
            'td',
            {},
            Object.entries(t.signals)
              .filter(([, n]) => n > 0)
              .map(([k]) => k)
              .join(', '),
          ),
          h('td', {}, label(t)),
          h(
            'td',
            {},
            segmented<TrackerAction | 'auto'>(
              [
                { value: 'auto', label: 'Auto' },
                { value: 'block', label: 'Block' },
                { value: 'cookieblock', label: 'Cookies' },
                { value: 'allow', label: 'Allow' },
              ],
              t.override ?? 'auto',
              async (v) => {
                await sendMessage('tracker:set', { domain: t.domain, action: v === 'auto' ? null : v });
                t.override = v === 'auto' ? null : v;
                toast('Saved');
              },
              `Action for ${t.domain}`,
            ),
          ),
        ),
      );
    tbody.replaceChildren(
      ...(rows.length > 0
        ? rows
        : [
            h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Nothing learned yet. Browse a little and come back.')),
          ]),
    );
  };
  search.addEventListener('input', draw);
  draw();

  const reset = h('button', { class: 'btn danger' }, 'Forget learned trackers');
  reset.addEventListener('click', async () => {
    if (!confirm('Forget everything Shomer has learned about trackers? Your explicit choices are kept.')) return;
    await sendMessage('trackers:reset', {});
    void route();
  });

  return [
    ...header(
      'Trackers',
      'Third parties Shomer has caught tracking you, how many sites they were seen on, and what Shomer does about them.',
    ),
    h('div', { class: 'toolbar' }, search, reset),
    h(
      'div',
      { class: 'panel' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, ...['Domain', 'Sites', 'Signals', 'Status', 'Action'].map((t) => h('th', {}, t)))),
        tbody,
      ),
    ),
  ];
}

/* -------------------------------------------------------------------------- */

async function sites(): Promise<HTMLElement[]> {
  const s = await sendMessage('settings:get', {});
  const input = h('input', { type: 'text', placeholder: 'example.com', 'aria-label': 'Site to trust' });
  const add = h('button', { class: 'btn' }, 'Add');
  add.addEventListener('click', async () => {
    const site = input.value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
    if (!isValidDomain(site)) {
      toast('That doesn’t look like a domain');
      return;
    }
    await sendMessage('site:allowlist', { site, value: true });
    void route();
  });

  const chips = h(
    'div',
    { class: 'chips' },
    ...(s.allowlist.length > 0
      ? s.allowlist.map((site) =>
          h(
            'span',
            { class: 'chip' },
            site,
            h(
              'button',
              {
                'aria-label': `Remove ${site}`,
                title: 'Remove',
                onclick: async () => {
                  await sendMessage('site:allowlist', { site, value: false });
                  void route();
                },
              },
              '×',
            ),
          ),
        )
      : [h('span', { class: 'muted' }, 'No trusted sites.')]),
  );

  const overrides = Object.entries(s.siteModules);
  const table = h(
    'div',
    { class: 'panel' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, ...['Site', 'Modules turned off', ''].map((t) => h('th', {}, t)))),
      h(
        'tbody',
        {},
        ...(overrides.length > 0
          ? overrides.map(([site, mods]) =>
              h(
                'tr',
                {},
                h('td', { class: 'mono' }, site),
                h(
                  'td',
                  {},
                  Object.keys(mods)
                    .map((m) => MODULE_INFO[m as ModuleId].name)
                    .join(', '),
                ),
                h(
                  'td',
                  {},
                  h(
                    'button',
                    {
                      class: 'btn',
                      onclick: async () => {
                        for (const m of Object.keys(mods) as ModuleId[])
                          await sendMessage('site:module', { site, module: m, value: null });
                        void route();
                      },
                    },
                    'Reset',
                  ),
                ),
              ),
            )
          : [h('tr', {}, h('td', { colspan: 3, class: 'muted' }, 'No per-site changes.'))]),
      ),
    ),
  );

  return [
    ...header('Sites', 'Sites where you changed how Shomer behaves.'),
    h('h2', {}, 'Trusted sites (Shomer fully off)'),
    h('div', { class: 'toolbar' }, input, add),
    chips,
    h('h2', {}, 'Per-site module switches'),
    table,
  ];
}

/* -------------------------------------------------------------------------- */

async function backup(): Promise<HTMLElement[]> {
  const exportBtn = h('button', { class: 'btn primary' }, 'Export settings');
  exportBtn.addEventListener('click', async () => {
    const data = await sendMessage('backup:export', {});
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', {
      href: URL.createObjectURL(blob),
      download: `shomer-backup-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Backup file' });
  const importBtn = h('button', { class: 'btn' }, 'Import');
  importBtn.addEventListener('click', async () => {
    const f = file.files?.[0];
    if (!f) return toast('Choose a backup file first');
    try {
      const result = await sendMessage('backup:import', { data: JSON.parse(await f.text()) });
      toast(result.ok ? 'Settings restored' : (result.error ?? 'Import failed'));
    } catch {
      toast('That file is not valid JSON');
    }
  });
  return [
    ...header('Backup', 'Move your settings, filters and learned trackers to another browser.'),
    h('div', { class: 'toolbar' }, exportBtn),
    h('h2', {}, 'Restore'),
    h('div', { class: 'toolbar' }, file, importBtn),
  ];
}

async function about(): Promise<HTMLElement[]> {
  const manifest = chrome.runtime.getManifest();
  return [
    ...header('About Shomer', 'שומר — “guardian”. An open-source, all-in-one privacy shield.'),
    h(
      'dl',
      { class: 'about' },
      h('dt', {}, 'Version'),
      h('dd', {}, manifest.version),
      h('dt', {}, 'Source code'),
      h('dd', {}, h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, REPO_URL)),
      h('dt', {}, 'License'),
      h('dd', {}, 'GNU GPL v3.0 or later'),
      h('dt', {}, 'Privacy'),
      h(
        'dd',
        {},
        'Shomer collects nothing. It makes no network requests of its own; everything it learns stays in your browser.',
      ),
    ),
    h('h2', {}, 'Standing on the shoulders of'),
    h(
      'p',
      { class: 'muted' },
      'Shomer is an independent implementation inspired by uBlock Origin, Privacy Badger, CanvasBlocker and I don’t care about cookies. ' +
        'Filter lists by the EasyList authors, the uBlock Origin team and Peter Lowe; the Public Suffix List by Mozilla.',
    ),
  ];
}

/* -------------------------------------------------------------------------- */

const ROUTES: Record<string, () => Promise<HTMLElement[]>> = {
  overview,
  protection,
  lists,
  filters,
  trackers,
  sites,
  backup,
  about,
};

async function route(): Promise<void> {
  const name = location.hash.slice(1) in ROUTES ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('.sidebar a').forEach((a) => {
    if (a.getAttribute('href') === `#${name}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    content.replaceChildren(...(await (ROUTES[name] ?? overview)()));
  } catch (error) {
    content.replaceChildren(h('p', { class: 'notice' }, `Could not load this section: ${String(error)}`));
  }
}

window.addEventListener('hashchange', () => {
  void route().then(() => content.focus());
});
void route();
