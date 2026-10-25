/* Shomer surrogate for Amazon Publisher Services (apstag.js). */
(function () {
  'use strict';
  var noop = function () {};
  window.apstag = {
    _Q: [],
    init: noop,
    setDisplayBids: noop,
    targetingKeys: function () { return []; },
    fetchBids: function (config, callback) {
      if (typeof callback === 'function') setTimeout(function () { callback([]); }, 1);
    },
  };
})();
