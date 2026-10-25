/**
 * Exposes `navigator.globalPrivacyControl = true` (MAIN world), matching the
 * `Sec-GPC: 1` request header. See https://globalprivacycontrol.org/.
 */
if (!('globalPrivacyControl' in Navigator.prototype)) {
  Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
    configurable: true,
    enumerable: true,
    get: Object.getOwnPropertyDescriptor(
      {
        get globalPrivacyControl() {
          return true;
        },
      },
      'globalPrivacyControl',
    )?.get,
  });
}
