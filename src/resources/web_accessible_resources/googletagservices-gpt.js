/* Shomer surrogate for Google Publisher Tag (gpt.js): every call is a no-op. */
(function () {
  'use strict';
  var noop = function () {};
  function chain(names) {
    var obj = {};
    names.forEach(function (n) { obj[n] = function () { return obj; }; });
    return obj;
  }
  var slotMethods = ['addService', 'clearCategoryExclusions', 'clearTargeting', 'defineSizeMapping', 'set',
    'setCategoryExclusion', 'setClickUrl', 'setCollapseEmptyDiv', 'setConfig', 'setForceSafeFrame',
    'setSafeFrameConfig', 'setTargeting', 'updateTargetingFromMap'];
  function Slot(path, id) {
    var slot = chain(slotMethods);
    slot.getAdUnitPath = function () { return path || ''; };
    slot.getSlotElementId = function () { return id || ''; };
    slot.getTargeting = function () { return []; };
    slot.getTargetingKeys = function () { return []; };
    slot.getResponseInformation = function () { return null; };
    slot.getSizes = function () { return []; };
    return slot;
  }
  var pubads = chain(['addEventListener', 'removeEventListener', 'clear', 'clearCategoryExclusions',
    'clearTagForChildDirectedTreatment', 'clearTargeting', 'collapseEmptyDivs', 'defineOutOfPagePassback',
    'definePassback', 'disableInitialLoad', 'display', 'enableAsyncRendering', 'enableLazyLoad',
    'enableSingleRequest', 'enableSyncRendering', 'enableVideoAds', 'refresh', 'set', 'setCategoryExclusion',
    'setCentering', 'setCookieOptions', 'setForceSafeFrame', 'setLocation', 'setPrivacySettings',
    'setPublisherProvidedId', 'setRequestNonPersonalizedAds', 'setSafeFrameConfig', 'setTagForChildDirectedTreatment',
    'setTargeting', 'setVideoContent', 'updateCorrelator']);
  pubads.getSlots = function () { return []; };
  pubads.getTargeting = function () { return []; };
  pubads.getTargetingKeys = function () { return []; };
  pubads.isInitialLoadDisabled = function () { return true; };
  var cmdQueue = (window.googletag && window.googletag.cmd) || [];
  var gt = {
    apiReady: true,
    pubadsReady: true,
    cmd: { push: function (fn) { try { fn(); } catch (e) { /* ignore */ } return 1; } },
    defineSlot: function (p, s, id) { return Slot(p, id); },
    defineOutOfPageSlot: function (p, id) { return Slot(p, id); },
    destroySlots: function () { return true; },
    disablePublisherConsole: noop,
    display: noop,
    enableServices: noop,
    getVersion: function () { return ''; },
    pubads: function () { return pubads; },
    companionAds: function () { return chain(['addEventListener', 'enableSyncLoading', 'setRefreshUnfilledSlots']); },
    content: function () { return chain(['addEventListener', 'setContent']); },
    setAdIframeTitle: noop,
    sizeMapping: function () {
      var m = { addSize: function () { return m; }, build: function () { return []; } };
      return m;
    },
  };
  window.googletag = gt;
  if (Array.isArray(cmdQueue)) cmdQueue.forEach(function (fn) { gt.cmd.push(fn); });
})();
