/**
 * Compiles a whole filter list into the three artefacts Shomer runs on:
 * declarativeNetRequest rules, a cosmetic bundle and a scriptlet bundle.
 *
 * Used at build time for the bundled lists and at runtime for "My filters".
 */
import { MAX_REGEX_RULES_PER_RULESET } from '../constants';
import type { DnrRuleDraft } from '../dnr-types';
import { canonicalScriptletName } from '../../scriptlets/names';
import {
  addCosmeticFilter,
  addScriptletFilter,
  emptyCosmeticBundle,
  emptyScriptletBundle,
  finalizeCosmeticBundle,
  finalizeScriptletBundle,
  type CosmeticBundle,
  type ScriptletBundle,
} from './cosmetic';
import { convertHostsEntry, convertNetworkFilter, optimizeRules } from './dnr';
import { badfilterKey, parseFilter, type NetworkFilter, type ParseOptions } from './parser';

export interface CompileOptions extends ParseOptions {
  priorityOffset?: number;
  /** Keep every unsupported line (for the "My filters" editor). */
  collectUnsupported?: boolean;
  /** Whether `##+js()` scriptlets are allowed (they aren't in "My filters"). */
  allowScriptlets?: boolean;
}

export interface CompileStats {
  lines: number;
  network: number;
  cosmetic: number;
  scriptlets: number;
  rules: number;
  unsupported: number;
  reasons: Record<string, number>;
}

export interface CompiledList {
  rules: DnrRuleDraft[];
  cosmetic: CosmeticBundle;
  scriptlets: ScriptletBundle;
  stats: CompileStats;
  unsupportedLines: { line: number; text: string; reason: string }[];
}

const PURE_HOST_RE = /^\|\|([a-z0-9_.-]+)\^?\|?$/i;

/** Hostnames a cosmetic network exception (`@@||host^$generichide`) applies to. */
function exceptionHosts(f: NetworkFilter): string[] {
  const m = PURE_HOST_RE.exec(f.pattern);
  if (m?.[1]) return [m[1].toLowerCase()];
  if (f.pattern === '' || f.pattern === '*') return f.domains.include;
  return [];
}

export function compileFilterList(text: string, options: CompileOptions = {}): CompiledList {
  const lines = text.split(/\r?\n/);
  const stats: CompileStats = {
    lines: 0,
    network: 0,
    cosmetic: 0,
    scriptlets: 0,
    rules: 0,
    unsupported: 0,
    reasons: {},
  };
  const unsupportedLines: CompiledList['unsupportedLines'] = [];
  const cosmetic = emptyCosmeticBundle();
  const scriptlets = emptyScriptletBundle();
  const drafts: DnrRuleDraft[] = [];
  const allowScriptlets = options.allowScriptlets ?? true;
  let regexRules = 0;

  const reject = (lineNo: number, raw: string, reason: string) => {
    stats.unsupported++;
    const bucket = reason.replace(/:.*/, '');
    stats.reasons[bucket] = (stats.reasons[bucket] ?? 0) + 1;
    if (options.collectUnsupported) unsupportedLines.push({ line: lineNo, text: raw, reason });
  };

  // Pass 1: $badfilter lines cancel matching filters, wherever they appear.
  const badfilters = new Set<string>();
  for (const line of lines) {
    if (line.includes('badfilter')) {
      const parsed = parseFilter(line, options);
      if (parsed?.kind === 'network' && parsed.badfilter) badfilters.add(badfilterKey(parsed.raw));
    }
  }

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const parsed = parseFilter(line, options);
    if (parsed === null) return;
    stats.lines++;

    switch (parsed.kind) {
      case 'unsupported':
        reject(lineNo, parsed.raw, parsed.reason);
        return;

      case 'hosts': {
        const result = convertHostsEntry(parsed, options);
        if (result.ok === true) {
          drafts.push(result.rule);
          stats.network++;
        } else if (result.ok === false) {
          reject(lineNo, parsed.raw, result.reason);
        }
        return;
      }

      case 'network': {
        if (parsed.badfilter) return;
        if (badfilters.has(badfilterKey(parsed.raw))) return;

        if (
          parsed.exception &&
          (parsed.elemhide || parsed.generichide || parsed.specifichide || parsed.types?.includes('document'))
        ) {
          const hosts = exceptionHosts(parsed);
          const all = parsed.elemhide || (parsed.types?.includes('document') ?? false);
          for (const h of hosts) {
            if (all) cosmetic.elemhide.push(h);
            else if (parsed.generichide) cosmetic.generichide.push(h);
            else if (parsed.specifichide) cosmetic.specifichide.push(h);
          }
        }

        const result = convertNetworkFilter(parsed, options);
        if (result.ok === 'cosmetic') {
          stats.network++;
          return;
        }
        if (result.ok === false) {
          reject(lineNo, parsed.raw, result.reason);
          return;
        }
        if (result.rule.condition.regexFilter !== undefined) {
          if (regexRules >= MAX_REGEX_RULES_PER_RULESET) {
            reject(lineNo, parsed.raw, 'regex-limit');
            return;
          }
          regexRules++;
        }
        drafts.push(result.rule);
        stats.network++;
        return;
      }

      case 'cosmetic':
        addCosmeticFilter(cosmetic, parsed);
        stats.cosmetic++;
        return;

      case 'scriptlet': {
        if (!allowScriptlets) {
          reject(lineNo, parsed.raw, 'scriptlets-not-allowed');
          return;
        }
        const name = parsed.name === '' ? '' : canonicalScriptletName(parsed.name);
        if (name === null) {
          reject(lineNo, parsed.raw, `scriptlet:${parsed.name}`);
          return;
        }
        addScriptletFilter(scriptlets, parsed, name);
        stats.scriptlets++;
        return;
      }
    }
  });

  const rules = optimizeRules(drafts);
  stats.rules = rules.length;
  return {
    rules,
    cosmetic: finalizeCosmeticBundle(cosmetic),
    scriptlets: finalizeScriptletBundle(scriptlets),
    stats,
    unsupportedLines,
  };
}
