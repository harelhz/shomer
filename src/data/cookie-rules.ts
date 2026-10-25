/**
 * Consent-management-platform (CMP) rules.
 *
 * Each rule recognises one CMP's dialog and describes how to say "no": click
 * "Reject all", or open the settings and save with everything off. Unlike
 * "I don't care about cookies", Shomer never clicks "Accept" — when it can't
 * find a way to refuse, it only hides the banner, which leaves you in the
 * same legal position as never answering (no consent given).
 *
 * Selectors may pierce open shadow roots with `>>>`.
 */

export type CmpStep =
  /** Click the first element matching the selector (waits up to `timeout` ms). */
  | { click: string; timeout?: number; optional?: boolean }
  /** Click the first button-like element inside `within` whose text matches `text` (regex source, case-insensitive). */
  | { clickText: string; within: string; timeout?: number; optional?: boolean }
  | { waitFor: string; timeout?: number; optional?: boolean }
  | { wait: number }
  | { if: string; then: CmpStep[]; else?: CmpStep[] };

export interface CmpRule {
  id: string;
  name: string;
  /** Presence (and visibility) of this element means the dialog is showing. */
  detect: string;
  /** Regex source; the rule only runs in frames whose URL matches. */
  frame?: string;
  /** Regex source; the rule only runs on matching hostnames. */
  hosts?: string;
  reject: CmpStep[];
}

export const REJECT_TEXT =
  '^\\s*(reject|decline|deny|refuse|disagree)(\\s+(all|cookies|all cookies|optional cookies|non-essential cookies|non-essential|additional cookies|and close))?\\s*$' +
  '|only (strictly )?(necessary|essential|required)|(necessary|essential|required)( cookies)? only' +
  '|continue without (accepting|agreeing)|i do not (accept|agree)|do not consent|refuse non-essential' +
  '|דחה|דחייה|דחיית|לסרב|סירוב|דחה הכל|דחיית הכל|רק (עוגיות |קבצי עוגיות )?(הכרחיות|נחוצות|חיוניות)|המשך ללא' +
  '|ablehnen|alle ablehnen|nur (notwendige|essenzielle|erforderliche)|refuser|tout refuser|continuer sans accepter' +
  '|rechazar|rechazar todo|rifiuta|rifiuta tutto|weiger|afwijzen|alles weigeren|odrzuć|odmítnout|avvisa|afvis|hylkää|recusar|отклонить|отказаться';

export const CMP_RULES: readonly CmpRule[] = [
  {
    id: 'onetrust',
    name: 'OneTrust',
    detect: '#onetrust-banner-sdk',
    reject: [
      {
        if: '#onetrust-reject-all-handler',
        then: [{ click: '#onetrust-reject-all-handler' }],
        else: [
          { click: '#onetrust-pc-btn-handler' },
          { waitFor: '#onetrust-pc-sdk' },
          {
            if: '.ot-pc-refuse-all-handler',
            then: [{ click: '.ot-pc-refuse-all-handler' }],
            else: [{ click: '#onetrust-pc-sdk .save-preference-btn-handler' }],
          },
        ],
      },
    ],
  },
  {
    id: 'cookiebot',
    name: 'Cookiebot',
    detect: '#CybotCookiebotDialog',
    reject: [
      {
        if: '#CybotCookiebotDialogBodyButtonDecline',
        then: [{ click: '#CybotCookiebotDialogBodyButtonDecline' }],
        else: [
          {
            click:
              '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll, #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection, #CybotCookiebotDialogBodyButtonAllowSelection',
          },
        ],
      },
    ],
  },
  {
    id: 'didomi',
    name: 'Didomi',
    detect: '#didomi-notice, #didomi-popup',
    reject: [
      {
        if: '#didomi-notice-disagree-button',
        then: [{ click: '#didomi-notice-disagree-button' }],
        else: [
          {
            if: '.didomi-continue-without-agreeing',
            then: [{ click: '.didomi-continue-without-agreeing' }],
            else: [
              { click: '#didomi-notice-learn-more-button' },
              { click: '.didomi-consent-popup-actions [class*="disagree"], button[aria-label*="Disagree to all" i]' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'quantcast',
    name: 'InMobi Choice (Quantcast)',
    detect: '.qc-cmp2-container, #qc-cmp2-container',
    reject: [{ clickText: REJECT_TEXT, within: '.qc-cmp2-summary-buttons, .qc-cmp2-footer' }],
  },
  {
    id: 'usercentrics',
    name: 'Usercentrics',
    detect: '#usercentrics-root, #usercentrics-cmp-ui',
    reject: [
      {
        click:
          '#usercentrics-root >>> [data-testid="uc-deny-all-button"], #usercentrics-cmp-ui >>> #deny, #usercentrics-cmp-ui >>> .deny',
        timeout: 4000,
      },
    ],
  },
  {
    id: 'trustarc',
    name: 'TrustArc',
    detect: '#truste-consent-track',
    reject: [{ click: '#truste-consent-required' }],
  },
  {
    id: 'sourcepoint',
    name: 'Sourcepoint',
    detect: '.message-container, .message, #notice',
    frame: 'privacy-mgmt\\.com|sp-prod\\.net|sourcepoint|sp_message_iframe',
    reject: [
      {
        if: 'button[title="Reject All" i], button.sp_choice_type_13, button.sp_choice_type_REJECT_ALL',
        then: [{ click: 'button[title="Reject All" i], button.sp_choice_type_13, button.sp_choice_type_REJECT_ALL' }],
        else: [{ clickText: REJECT_TEXT, within: '.message-component, .message, #notice' }],
      },
    ],
  },
  {
    id: 'osano',
    name: 'Osano',
    detect: '.osano-cm-dialog:not(.osano-cm-dialog--hidden)',
    reject: [{ click: '.osano-cm-denyAll, .osano-cm-deny' }],
  },
  {
    id: 'cookieyes',
    name: 'CookieYes',
    detect: '.cky-consent-container:not(.cky-hide)',
    reject: [{ click: '.cky-btn-reject' }],
  },
  {
    id: 'cookie-law-info',
    name: 'GDPR Cookie Consent (WordPress)',
    detect: '#cookie-law-info-bar',
    reject: [{ click: '#cookie_action_close_header_reject, .cli_action_button[data-cli_action="reject"]' }],
  },
  {
    id: 'complianz',
    name: 'Complianz',
    detect: '.cmplz-cookiebanner:not(.cmplz-hidden)',
    reject: [{ click: '.cmplz-cookiebanner .cmplz-deny' }],
  },
  {
    id: 'iubenda',
    name: 'iubenda',
    detect: '#iubenda-cs-banner',
    reject: [{ click: '.iubenda-cs-reject-btn' }],
  },
  {
    id: 'borlabs',
    name: 'Borlabs Cookie',
    detect: '#BorlabsCookieBox',
    reject: [
      {
        click:
          '#BorlabsCookieBox a[data-cookie-refuse], #BorlabsCookieBox ._brlbs-refuse-btn a, #BorlabsCookieBox ._brlbs-refuse',
      },
    ],
  },
  {
    id: 'klaro',
    name: 'Klaro',
    detect: '.klaro .cookie-notice, .klaro .cookie-modal',
    reject: [{ click: '.klaro .cm-btn-decline, .klaro .cn-decline' }],
  },
  {
    id: 'termly',
    name: 'Termly',
    detect: '[data-tid="banner-decline"]',
    reject: [{ click: '[data-tid="banner-decline"]' }],
  },
  {
    id: 'cookie-notice',
    name: 'Cookie Notice (WordPress)',
    detect: '#cookie-notice',
    reject: [{ click: '#cn-refuse-cookie' }],
  },
  {
    id: 'moove',
    name: 'GDPR Cookie Compliance (Moove)',
    detect: '#moove_gdpr_cookie_info_bar',
    reject: [{ click: '.moove-gdpr-infobar-reject-btn' }],
  },
  {
    id: 'cookiefirst',
    name: 'CookieFirst',
    detect: '.cookiefirst-root',
    reject: [{ click: '[data-cookiefirst-action="reject"]' }],
  },
  {
    id: 'axeptio',
    name: 'Axeptio',
    detect: '#axeptio_overlay',
    reject: [{ click: '#axeptio_btn_dismiss' }],
  },
  {
    id: 'funding-choices',
    name: 'Google Funding Choices',
    detect: '.fc-consent-root',
    reject: [{ clickText: REJECT_TEXT, within: '.fc-consent-root' }],
  },
  {
    id: 'consentmanager',
    name: 'consentmanager.net',
    detect: '#cmpbox, #cmpwrapper',
    reject: [{ click: '#cmpbox .cmpboxbtnno, #cmpwrapper >>> .cmpboxbtnno' }],
  },
  {
    id: 'cookie-script',
    name: 'Cookie-Script',
    detect: '#cookiescript_injected',
    reject: [{ click: '#cookiescript_reject' }],
  },
  {
    id: 'cookieconsent',
    name: 'Cookie Consent (Osano open source)',
    detect: '.cc-window:not(.cc-invisible)',
    reject: [{ click: '.cc-window .cc-deny' }],
  },
  {
    id: 'shopify',
    name: 'Shopify privacy banner',
    detect: '#shopify-pc__banner',
    reject: [{ click: '#shopify-pc__banner__btn-decline' }],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    detect: '#hs-eu-cookie-confirmation',
    reject: [{ click: '#hs-eu-decline-button' }],
  },
  {
    id: 'amazon',
    name: 'Amazon',
    detect: '#sp-cc',
    reject: [{ click: '#sp-cc-rejectall-link' }],
  },
  {
    id: 'meta',
    name: 'Facebook / Instagram',
    detect: '[data-cookiebanner="accept_only_essential_button"], div[role="dialog"] button',
    hosts: '(^|\\.)(facebook|instagram)\\.com$',
    reject: [
      {
        if: '[data-cookiebanner="accept_only_essential_button"]',
        then: [{ click: '[data-cookiebanner="accept_only_essential_button"]' }],
        else: [
          {
            clickText: 'decline optional cookies|only allow essential cookies',
            within: 'div[role="dialog"]',
            optional: true,
          },
        ],
      },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    detect: 'form[action*="consent.google"], div[aria-modal="true"] button',
    hosts: '(^|\\.)(google\\.[a-z.]+|consent\\.google\\.com)$',
    reject: [
      {
        clickText: '^\\s*reject all\\s*$|^\\s*דחה הכול\\s*$|^\\s*דחיית הכול\\s*$|alle ablehnen|tout refuser',
        within: 'body',
        optional: true,
      },
    ],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    detect:
      'ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog.ytd-consent-bump-v2-lightbox, form[action*="consent.youtube"]',
    hosts: '(^|\\.)(youtube\\.com|consent\\.youtube\\.com)$',
    reject: [
      {
        click:
          'ytd-consent-bump-v2-lightbox button[aria-label*="Reject" i], form[action*="consent"] button[aria-label*="Reject" i]',
      },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    detect: 'button[action-type="DENY"]',
    hosts: '(^|\\.)linkedin\\.com$',
    reject: [{ click: 'button[action-type="DENY"]' }],
  },
  {
    id: 'reddit',
    name: 'Reddit',
    detect: 'reddit-cookie-banner',
    hosts: '(^|\\.)reddit\\.com$',
    reject: [
      {
        click:
          'reddit-cookie-banner >>> #reject-nonessential-cookies-button, reddit-cookie-banner >>> button[id*="reject"]',
      },
    ],
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    detect: '[data-testid="BottomBar"]',
    hosts: '(^|\\.)(twitter|x)\\.com$',
    reject: [{ clickText: 'refuse non-essential cookies', within: '[data-testid="BottomBar"]' }],
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    detect: '#wcpConsentBannerCtrl',
    reject: [{ clickText: REJECT_TEXT, within: '#wcpConsentBannerCtrl' }],
  },
];
