/**
 * Cosmetic rules for cookie banners, injected on every site where the cookie
 * module is on (on top of the uBlock "Cookie notices" list).
 */

/** Containers of well-known CMP dialogs and common hand-rolled banners. */
export const COOKIE_BANNER_SELECTORS: readonly string[] = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk .onetrust-pc-dark-filter',
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay',
  '#didomi-host',
  '.qc-cmp2-container',
  '#qc-cmp2-container',
  '#truste-consent-track',
  '#consent_blackbar',
  '.truste_overlay',
  '.truste_box_overlay',
  '#usercentrics-root',
  '#usercentrics-cmp-ui',
  '.osano-cm-window',
  '#cookie-law-info-bar',
  '.cli-modal-backdrop',
  '.cky-consent-container',
  '.cky-overlay',
  '.cmplz-cookiebanner',
  '#cmplz-cookiebanner-container',
  '#iubenda-cs-banner',
  '#BorlabsCookieBox',
  '.klaro .cookie-notice',
  '.klaro .cookie-modal',
  '#termly-code-snippet-support',
  '[id^="sp_message_container_"]',
  '#cookie-notice',
  '#moove_gdpr_cookie_info_bar',
  '.cookiefirst-root',
  '#axeptio_overlay',
  '.fc-consent-root',
  '#cmpbox',
  '#cmpbox2',
  '#cmpwrapper',
  '#cookiescript_injected',
  '#cookiescript_injected_wrapper',
  '#shopify-pc__banner',
  '#hs-eu-cookie-confirmation',
  '#sp-cc',
  '.cc-window',
  '.cc-banner',
  '#gdpr-cookie-message',
  '#cookie-banner',
  '.cookie-banner',
  '#cookieBanner',
  '#cookie-consent',
  '.cookie-consent-banner',
  '#cookieConsent',
  '#CookieConsent',
  '#cookie-bar',
  '.cookie-bar',
  '#cookiebar',
  '#cookies-banner',
  '.cookies-banner',
  '#cookieNotice',
  '#cookie_notice',
  '.js-cookie-banner',
  '#cookie-popup',
  '.cookie-popup',
  '#gdpr-banner',
  '.gdpr-banner',
  '#cookiesAlert',
  '#cookie-message',
  '#cookieChoiceInfo',
  '#cookie-law-banner',
  '#cookie-policy-banner',
  '.cookie-policy-banner',
  '#ccc', // Civic Cookie Control
  '#ccc-overlay',
];

/**
 * Many CMPs lock scrolling while their dialog is open by adding a class to
 * <html> or <body>. When we hide the dialog we must undo that.
 */
export const SCROLL_LOCK_SELECTORS: readonly string[] = [
  'html.didomi-popup-open',
  'body.didomi-popup-open',
  'html.sp-message-open',
  'body.sp-message-open',
  'body.cli-barmodal-open',
  'html.qc-cmp-ui-showing',
  'body.qc-cmp-ui-showing',
  'body.cky-modal-open',
  'html.cmplz-blocked',
  'body.cookiebanner-open',
  'body.cookie-consent-open',
  'html.has-cookie-banner',
  'body.has-cookie-banner',
  'body.iubenda-cs-visible',
  'html.wcp-consent-open',
  'body.ot-overflow-hidden',
  'html.ccc-open',
];

export function cookieBannerCss(mode: 'reject' | 'hide'): string {
  // In "reject" mode the dialog stays rendered (but invisible and
  // click-through) so that the CMP's scripts behave normally while Shomer
  // clicks "reject". In "hide" mode it is removed from layout.
  const hide =
    mode === 'reject'
      ? 'opacity:0!important;pointer-events:none!important;visibility:hidden!important'
      : 'display:none!important';
  const rules = COOKIE_BANNER_SELECTORS.map((s) => `${s}{${hide}}`);
  rules.push(...SCROLL_LOCK_SELECTORS.map((s) => `${s}{overflow:auto!important;position:static!important}`));
  return rules.join('\n');
}
