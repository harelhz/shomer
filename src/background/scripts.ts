/**
 * MAIN-world content scripts: the fingerprint shield, the GPC property and
 * the per-list scriptlet bundles.
 *
 * They must run before any page script, which rules out injecting them on
 * demand with messaging (too late). Instead they're registered with
 * `scripting.registerContentScripts`, and re-registered whenever settings
 * change, with `excludeMatches` implementing per-site switches.
 */
import { RULESETS } from '../shared/constants';
import { enabledRulesetIds, sitesWithModuleOff, type Settings } from '../shared/settings';
import { sitePatterns } from '../shared/util';
import { buildMeta } from './rulesets';

type Registration = chrome.scripting.RegisteredContentScript;

const WEB = ['http://*/*', 'https://*/*'];

function exclude(sites: string[]): string[] | undefined {
  return sites.length > 0 ? sites.flatMap(sitePatterns) : undefined;
}

export async function desiredScripts(settings: Settings): Promise<Registration[]> {
  const out: Registration[] = [];
  const base = {
    runAt: 'document_start' as const,
    allFrames: true,
    persistAcrossSessions: true,
    world: 'MAIN' as const,
  };

  if (settings.modules.fingerprint) {
    out.push({
      ...base,
      id: 'fingerprint',
      js: [`content/fingerprint-${settings.fingerprintLevel}.js`],
      matches: WEB,
      excludeMatches: exclude(sitesWithModuleOff(settings, 'fingerprint')),
      matchOriginAsFallback: true,
    });
  }

  if (settings.rulesets['privacy-headers']) {
    out.push({ ...base, id: 'gpc', js: ['content/gpc.js'], matches: WEB, excludeMatches: exclude(settings.allowlist) });
  }

  const meta = await buildMeta();
  const enabled = new Set(enabledRulesetIds(settings));
  for (const list of RULESETS) {
    const entry = meta.scriptlets[list.id];
    if (!entry || !enabled.has(list.id) || entry.matches.length === 0) continue;
    const module = list.module === 'privacy' ? 'adblock' : list.module;
    out.push({
      ...base,
      id: `scriptlets-${list.id}`,
      js: [entry.file],
      matches: entry.matches,
      excludeMatches: exclude(sitesWithModuleOff(settings, module)),
    });
  }
  return out;
}

const key = (r: Registration) =>
  JSON.stringify([r.js, r.matches, r.excludeMatches ?? [], r.world, r.allFrames, r.runAt, r.matchOriginAsFallback]);

export async function syncScripts(settings: Settings): Promise<void> {
  const desired = await desiredScripts(settings);
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const desiredById = new Map(desired.map((r) => [r.id, r]));

  const stale = existing.filter((r) => {
    const d = desiredById.get(r.id);
    return !d || key(d) !== key({ ...r, matchOriginAsFallback: r.matchOriginAsFallback ?? d.matchOriginAsFallback });
  });
  if (stale.length > 0) await chrome.scripting.unregisterContentScripts({ ids: stale.map((r) => r.id) });

  const existingIds = new Set(existing.filter((r) => !stale.includes(r)).map((r) => r.id));
  const toRegister = desired.filter((r) => !existingIds.has(r.id));
  for (const reg of toRegister) {
    try {
      await chrome.scripting.registerContentScripts([reg]);
    } catch (error) {
      // Older Firefox versions don't know matchOriginAsFallback.
      if (reg.matchOriginAsFallback) {
        const { matchOriginAsFallback: _unused, ...rest } = reg;
        await chrome.scripting.registerContentScripts([{ ...rest, matchAboutBlank: true } as unknown as Registration]);
      } else {
        throw error;
      }
    }
  }
}
