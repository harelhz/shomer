/**
 * Downloads the filter lists and the Public Suffix List, compiles them, and
 * writes everything the extension needs into build/:
 *
 *   build/rulesets/<id>.json             static DNR ruleset
 *   build/rulesets/<id>.cosmetic.json    cosmetic bundle (if any)
 *   build/rulesets/<id>.scriptlets.json  scriptlet bundle (if any; inlined into JS by build.ts)
 *   build/rulesets/meta.json             counts, build time, scriptlet registrations
 *   build/report.json                    what couldn't be converted, and why
 *   src/generated/psl.ts                 the Public Suffix List
 *
 * Usage: tsx scripts/compile-lists.ts [--offline] [--refresh]
 *   --offline  only use cached downloads
 *   --refresh  ignore the cache age and re-download
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIORITY, RULESETS } from '../src/shared/constants';
import { compileFilterList, type CompileStats } from '../src/shared/filters/compiler';
import { assignIds } from '../src/shared/filters/dnr';
import type { DnrRuleDraft } from '../src/shared/dnr-types';
import { ALL_RESOURCE_TYPES } from '../src/shared/dnr-types';
import { TRACKING_PARAMS } from '../src/data/trackers';
import { buildDate } from './build-date';
import { LIST_SOURCES, PSL_URLS } from './lists.config';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'lists');
const OUT = join(ROOT, 'build', 'rulesets');
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const refresh = args.has('--refresh');

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function download(id: string, urls: string[]): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, `${id}.txt`);
  const fresh = existsSync(cached) && Date.now() - statSync(cached).mtimeMs < MAX_CACHE_AGE_MS;
  if (offline || (fresh && !refresh)) {
    if (existsSync(cached)) return readFileSync(cached, 'utf8');
    if (offline) throw new Error(`No cached copy of ${id} (offline mode)`);
  }
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length < 100) throw new Error('suspiciously short response');
      writeFileSync(cached, text);
      log(`  ↓ ${id} ← ${url} (${(text.length / 1024).toFixed(0)} KiB)`);
      return text;
    } catch (error) {
      log(`  ! ${id}: ${url} failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (existsSync(cached)) {
    log(`  ! ${id}: using stale cache`);
    return readFileSync(cached, 'utf8');
  }
  throw new Error(`Could not download ${id}`);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

/**
 * "Clean URLs": strip tracking parameters from page loads.
 *
 * The regex only exists so we redirect when there is something to remove.
 * Chrome's RE2 has a small per-rule memory budget, and one alternation of all
 * the parameter names exceeds it, so the names are split across several rules.
 */
function urlCleaningRules(): DnrRuleDraft[] {
  const names = TRACKING_PARAMS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const rules: DnrRuleDraft[] = [];
  for (let i = 0; i < names.length; i += 8) {
    rules.push({
      priority: PRIORITY.LIST_REDIRECT,
      action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: [...TRACKING_PARAMS] } } } },
      condition: {
        regexFilter: `[?&](${names.slice(i, i + 8).join('|')})=`,
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    });
  }
  return rules;
}

/** Global Privacy Control + Do Not Track on every request. */
function privacyHeaderRules(): DnrRuleDraft[] {
  return [
    {
      priority: PRIORITY.PRIVACY_HEADERS,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Sec-GPC', operation: 'set', value: '1' },
          { header: 'DNT', operation: 'set', value: '1' },
        ],
      },
      condition: { resourceTypes: [...ALL_RESOURCE_TYPES] },
    },
  ];
}

function scriptletMatches(hosts: string[]): string[] {
  const patterns = new Set<string>();
  for (const host of hosts) {
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) continue;
    patterns.add(`*://${host}/*`);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) patterns.add(`*://*.${host}/*`);
  }
  return [...patterns].sort();
}

async function main(): Promise<void> {
  log('Compiling filter lists…');
  mkdirSync(OUT, { recursive: true });

  const psl = await download('public_suffix_list', PSL_URLS);
  mkdirSync(join(ROOT, 'src', 'generated'), { recursive: true });
  writeFileSync(
    join(ROOT, 'src', 'generated', 'psl.ts'),
    `// Generated by scripts/compile-lists.ts from the Public Suffix List (MPL-2.0). Do not edit.\n` +
      `export const PSL_TEXT = ${JSON.stringify(
        psl
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '' && !l.startsWith('//'))
          .join('\n'),
      )};\n`,
  );

  const meta = {
    version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string,
    builtAt: buildDate().toISOString(),
    lists: {} as Record<
      string,
      { network: number; rules: number; cosmetic: number; scriptlets: number; unsupported: number }
    >,
    scriptlets: {} as Record<string, { file: string; matches: string[] }>,
    cosmetic: [] as string[],
  };
  const report: Record<string, CompileStats> = {};

  for (const ruleset of RULESETS) {
    let rules: DnrRuleDraft[];
    let stats: CompileStats;
    if (ruleset.id === 'url-cleaning' || ruleset.id === 'privacy-headers') {
      rules = ruleset.id === 'url-cleaning' ? urlCleaningRules() : privacyHeaderRules();
      stats = {
        lines: 0,
        network: rules.length,
        cosmetic: 0,
        scriptlets: 0,
        rules: rules.length,
        unsupported: 0,
        reasons: {},
      };
    } else {
      const source = LIST_SOURCES[ruleset.id];
      if (!source) throw new Error(`No source configured for ${ruleset.id}`);
      const text = source.file
        ? readFileSync(join(ROOT, source.file), 'utf8')
        : await download(ruleset.id, source.urls ?? []);
      const compiled = compileFilterList(text, { format: source.format });
      rules = compiled.rules;
      stats = compiled.stats;

      const c = compiled.cosmetic;
      const hasCosmetic =
        c.high.length +
          Object.keys(c.lowly).length +
          Object.keys(c.specific).length +
          Object.keys(c.procedural).length >
          0 ||
        c.genericExceptions.length + Object.keys(c.exceptions).length + c.elemhide.length + c.generichide.length > 0;
      if (hasCosmetic) {
        writeJson(join(OUT, `${ruleset.id}.cosmetic.json`), c);
        meta.cosmetic.push(ruleset.id);
      }
      const hosts = Object.keys(compiled.scriptlets.entries);
      if (hosts.length > 0) {
        writeJson(join(OUT, `${ruleset.id}.scriptlets.json`), compiled.scriptlets);
        meta.scriptlets[ruleset.id] = { file: `scriptlets/${ruleset.id}.js`, matches: scriptletMatches(hosts) };
      }
    }
    writeJson(join(OUT, `${ruleset.id}.json`), assignIds(rules));
    meta.lists[ruleset.id] = {
      network: stats.network,
      rules: rules.length,
      cosmetic: stats.cosmetic,
      scriptlets: stats.scriptlets,
      unsupported: stats.unsupported,
    };
    report[ruleset.id] = stats;
    log(
      `  ✓ ${ruleset.id.padEnd(16)} ${String(stats.network).padStart(6)} network → ${String(rules.length).padStart(5)} rules, ` +
        `${String(stats.cosmetic).padStart(5)} cosmetic, ${String(stats.scriptlets).padStart(4)} scriptlets, ` +
        `${String(stats.unsupported).padStart(4)} unsupported`,
    );
  }

  writeJson(join(OUT, 'meta.json'), meta);
  writeFileSync(join(ROOT, 'build', 'report.json'), JSON.stringify(report, null, 2));
  const total = Object.values(meta.lists).reduce((a, l) => a + l.rules, 0);
  log(`Done: ${total} static DNR rules.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
