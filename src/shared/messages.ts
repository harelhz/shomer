/**
 * The message protocol between content scripts, extension pages and the
 * background service worker. Every message type maps to a request and a
 * response type, so both sides are checked by the compiler.
 */
import type { ModuleId } from './constants';
import type { Settings, TrackerAction } from './settings';

export interface ContentInitResponse {
  /** False when the page is allowlisted or not supported. */
  active: boolean;
  cosmetic: boolean;
  /** Whether lowly-generic token reporting is useful on this page. */
  generic: boolean;
  procedural: string[];
  cookies: { mode: 'reject' | 'hide' } | null;
}

export interface ThirdPartyInfo {
  domain: string;
  requests: number;
  blocked: number;
  /** Seen doing something tracker-like on this page. */
  tracking: boolean;
  /** Number of distinct sites it has been seen tracking on. */
  sites: number;
  /** Effective action and where it comes from. */
  action: TrackerAction | 'none';
  source: 'user' | 'learned' | 'list' | 'none';
}

export interface PopupData {
  tabId: number;
  url: string;
  hostname: string;
  site: string;
  supported: boolean;
  allowlisted: boolean;
  /** Sites a tracker must be seen on before it is blocked. */
  threshold: number;
  modules: Record<ModuleId, { global: boolean; site: boolean }>;
  stats: { blocked: number; fingerprint: number; cookie: { cmp: string; action: string } | null };
  fingerprintApis: string[];
  thirdParties: ThirdPartyInfo[];
}

export interface TrackerListItem {
  domain: string;
  sites: string[];
  firstSeen: number;
  lastSeen: number;
  signals: Record<string, number>;
  learnedAction: TrackerAction | 'none';
  override: TrackerAction | null;
}

export interface RulesetInfo {
  id: string;
  name: string;
  description: string;
  module: string;
  homepage?: string;
  license?: string;
  enabled: boolean;
  active: boolean;
  network: number;
  rules: number;
  cosmetic: number;
  scriptlets: number;
  unsupported: number;
}

export interface OverviewData {
  version: string;
  builtAt: string;
  stats: GlobalStats;
  rulesets: RulesetInfo[];
  dynamicRules: number;
  availableStaticRules: number | null;
  learnedTrackers: number;
  blockedTrackers: number;
  lastError: string | null;
}

export interface GlobalStats {
  since: number;
  blocked: number;
  fingerprint: number;
  cookies: number;
  learned: number;
}

export interface FilterCompileReport {
  ok: boolean;
  rules: number;
  cosmetic: number;
  errors: { line: number; text: string; reason: string }[];
}

export interface BackupData {
  app: 'shomer';
  version: string;
  exportedAt: string;
  settings: Settings;
  trackers?: unknown;
}

export interface MessageMap {
  'content:init': { req: { url: string }; res: ContentInitResponse };
  'content:tokens': { req: { tokens: string[] }; res: void };
  'content:fp': { req: { api: string; script: string }; res: void };
  'content:cookie': { req: { cmp: string; action: 'rejected' | 'hidden' }; res: void };
  'picker:create': { req: { selector: string }; res: { ok: boolean; filter?: string } };
  'picker:start': { req: { tabId: number; zapper: boolean }; res: { ok: boolean } };
  'popup:get': { req: { tabId: number }; res: PopupData | null };
  'settings:get': { req: Record<string, never>; res: Settings };
  'settings:update': { req: { patch: Partial<Settings> }; res: Settings };
  'site:allowlist': { req: { site: string; value: boolean }; res: Settings };
  'site:module': { req: { site: string; module: ModuleId; value: boolean | null }; res: Settings };
  'tracker:set': { req: { domain: string; action: TrackerAction | null }; res: Settings };
  'trackers:list': { req: Record<string, never>; res: TrackerListItem[] };
  'trackers:reset': { req: Record<string, never>; res: void };
  'filters:set': { req: { text: string }; res: FilterCompileReport };
  'overview:get': { req: Record<string, never>; res: OverviewData };
  'backup:export': { req: Record<string, never>; res: BackupData };
  'backup:import': { req: { data: unknown }; res: { ok: boolean; error?: string } };
}

export type MessageType = keyof MessageMap;
export type Request<K extends MessageType = MessageType> = { type: K } & MessageMap[K]['req'];
export type Response<K extends MessageType> = MessageMap[K]['res'];

/** Message types only extension pages (popup, dashboard) may send. */
export const PRIVILEGED_MESSAGES: ReadonlySet<MessageType> = new Set<MessageType>([
  'picker:start',
  'popup:get',
  'settings:get',
  'settings:update',
  'site:allowlist',
  'site:module',
  'tracker:set',
  'trackers:list',
  'trackers:reset',
  'filters:set',
  'overview:get',
  'backup:export',
  'backup:import',
]);

export async function sendMessage<K extends MessageType>(type: K, payload: MessageMap[K]['req']): Promise<Response<K>> {
  const response = (await chrome.runtime.sendMessage({ type, ...payload })) as Response<K> | { __error: string };
  if (response && typeof response === 'object' && '__error' in response) throw new Error(response.__error);
  return response as Response<K>;
}
