/**
 * Minimal, dependency-free declarativeNetRequest types.
 *
 * These mirror `chrome.declarativeNetRequest.Rule` closely enough to be
 * assignable to it, but they don't depend on `@types/chrome`, which lets the
 * same compiler code run in Node at build time and in the extension at runtime.
 */

export type ResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

export const ALL_RESOURCE_TYPES: readonly ResourceType[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];

export type RequestMethod = 'connect' | 'delete' | 'get' | 'head' | 'options' | 'patch' | 'post' | 'put';

export interface DnrCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  resourceTypes?: ResourceType[];
  excludedResourceTypes?: ResourceType[];
  requestMethods?: RequestMethod[];
  excludedRequestMethods?: RequestMethod[];
  domainType?: 'firstParty' | 'thirdParty';
}

export interface DnrHeaderInfo {
  header: string;
  operation: 'append' | 'set' | 'remove';
  value?: string;
}

export interface DnrRedirect {
  extensionPath?: string;
  url?: string;
  transform?: {
    query?: string;
    queryTransform?: {
      removeParams?: string[];
    };
  };
}

export interface DnrAction {
  type: 'block' | 'redirect' | 'allow' | 'upgradeScheme' | 'modifyHeaders' | 'allowAllRequests';
  redirect?: DnrRedirect;
  requestHeaders?: DnrHeaderInfo[];
  responseHeaders?: DnrHeaderInfo[];
}

export interface DnrRule {
  id: number;
  priority: number;
  action: DnrAction;
  condition: DnrCondition;
}

/** A rule before an id has been assigned to it. */
export type DnrRuleDraft = Omit<DnrRule, 'id'>;

/** Rule actions Chrome counts against the (smaller) "unsafe" dynamic rule quota. */
export function isUnsafeRule(rule: DnrRuleDraft): boolean {
  const t = rule.action.type;
  return t === 'redirect' || t === 'modifyHeaders';
}
