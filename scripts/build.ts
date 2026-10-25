/**
 * Builds the extension for Chrome and/or Firefox into dist/<browser>/.
 *
 * Usage: tsx scripts/build.ts [--browser chrome|firefox|all] [--dev]
 *
 * Runs compile-lists.ts first if build/rulesets is missing.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { RULESETS } from '../src/shared/constants';
import { RESOURCES_DIR } from '../src/shared/filters/resources';
import { buildDate } from './build-date';

type Browser = 'chrome' | 'firefox';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'build');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string; description: string };

const argv = process.argv.slice(2);
const browserArg = argv[argv.indexOf('--browser') + 1] ?? 'all';
const dev = argv.includes('--dev');
const browsers: Browser[] = browserArg === 'chrome' || browserArg === 'firefox' ? [browserArg] : ['chrome', 'firefox'];

interface Meta {
  scriptlets: Record<string, { file: string; matches: string[] }>;
}

function manifest(browser: Browser): Record<string, unknown> {
  const icons = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  };
  const base: Record<string, unknown> = {
    manifest_version: 3,
    name: 'Shomer — Privacy Shield',
    short_name: 'Shomer',
    version: pkg.version,
    description: pkg.description,
    icons,
    action: { default_popup: 'ui/popup.html', default_icon: icons, default_title: 'Shomer' },
    options_ui: { page: 'ui/dashboard.html', open_in_tab: true },
    permissions: [
      'declarativeNetRequest',
      'declarativeNetRequestFeedback',
      'scripting',
      'storage',
      'webRequest',
      'contextMenus',
      'privacy',
    ],
    host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content/content.js'],
        run_at: 'document_start',
        all_frames: true,
        match_about_blank: true,
      },
    ],
    declarative_net_request: {
      rule_resources: RULESETS.map((r) => ({ id: r.id, enabled: r.defaultEnabled, path: `rulesets/${r.id}.json` })),
    },
    web_accessible_resources: [{ resources: [`${RESOURCES_DIR}/*`], matches: ['<all_urls>'] }],
    commands: {
      'open-picker': {
        suggested_key: { default: 'Alt+Shift+B' },
        description: 'Block an element on the current page',
      },
    },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };

  if (browser === 'chrome') {
    return {
      ...base,
      minimum_chrome_version: '121',
      background: { service_worker: 'background.js', type: 'module' },
      web_accessible_resources: [{ resources: [`${RESOURCES_DIR}/*`], matches: ['<all_urls>'], use_dynamic_url: true }],
    };
  }
  return {
    ...base,
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: 'shomer@shomer-privacy.github.io',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}

async function bundle(browser: Browser, out: string): Promise<void> {
  const common: esbuild.BuildOptions = {
    bundle: true,
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    target: browser === 'chrome' ? 'chrome121' : 'firefox128',
    legalComments: 'none',
    logLevel: 'warning',
    define: {
      __VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(buildDate().toISOString()),
      __BROWSER__: JSON.stringify(browser),
    },
  };
  const src = join(ROOT, 'src');

  await esbuild.build({
    ...common,
    format: 'esm',
    entryPoints: [join(src, 'background/index.ts')],
    outfile: join(out, 'background.js'),
  });

  await esbuild.build({
    ...common,
    format: 'iife',
    entryPoints: {
      'content/content': join(src, 'content/index.ts'),
      'content/fingerprint-standard': join(src, 'content/fingerprint/standard.ts'),
      'content/fingerprint-strict': join(src, 'content/fingerprint/strict.ts'),
      'content/gpc': join(src, 'content/gpc.ts'),
      'content/picker': join(src, 'content/picker/picker.ts'),
      'ui/popup': join(src, 'ui/popup/popup.ts'),
      'ui/dashboard': join(src, 'ui/dashboard/dashboard.ts'),
      'ui/onboarding': join(src, 'ui/onboarding/onboarding.ts'),
    },
    outdir: out,
  });

  // One scriptlet bundle per list, with the list's table inlined.
  const meta = JSON.parse(readFileSync(join(BUILD, 'rulesets', 'meta.json'), 'utf8')) as Meta;
  for (const [id, entry] of Object.entries(meta.scriptlets)) {
    const data = readFileSync(join(BUILD, 'rulesets', `${id}.scriptlets.json`), 'utf8');
    await esbuild.build({
      ...common,
      format: 'iife',
      entryPoints: [join(src, 'scriptlets/runtime.ts')],
      outfile: join(out, entry.file),
      define: { ...common.define, __SCRIPTLET_DATA__: data },
    });
  }
}

function copyStatic(out: string): void {
  const src = join(ROOT, 'src');
  for (const page of ['popup', 'dashboard', 'onboarding']) {
    cpSync(join(src, `ui/${page}/${page}.html`), join(out, `ui/${page}.html`));
    cpSync(join(src, `ui/${page}/${page}.css`), join(out, `ui/${page}.css`));
  }
  cpSync(join(src, 'ui/shared/theme.css'), join(out, 'ui/theme.css'));
  cpSync(join(src, 'icons'), join(out, 'icons'), { recursive: true });
  cpSync(join(src, 'resources', RESOURCES_DIR), join(out, RESOURCES_DIR), { recursive: true });
  mkdirSync(join(out, 'rulesets'), { recursive: true });
  for (const file of readdirSync(join(BUILD, 'rulesets'))) {
    if (!file.endsWith('.scriptlets.json')) cpSync(join(BUILD, 'rulesets', file), join(out, 'rulesets', file));
  }
  cpSync(join(ROOT, 'LICENSE'), join(out, 'LICENSE'));
}

async function main(): Promise<void> {
  if (!existsSync(join(BUILD, 'rulesets', 'meta.json'))) {
    execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/compile-lists.ts')], { stdio: 'inherit' });
  }
  for (const browser of browsers) {
    const out = join(ROOT, 'dist', browser);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    await bundle(browser, out);
    copyStatic(out);
    writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest(browser), null, 2)}\n`);
    process.stdout.write(`Built dist/${browser}\n`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
