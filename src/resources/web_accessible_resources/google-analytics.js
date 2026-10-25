/*
 * Shomer surrogate for Google Analytics (analytics.js / ga.js / gtm.js).
 * Provides no-op versions of the APIs pages call, and runs the callbacks
 * pages wait for, so that links and forms gated on analytics still work.
 */
(function () {
  'use strict';
  var noop = function () {};
  var later = function (fn) {
    try { setTimeout(fn, 1); } catch (e) { /* ignore */ }
  };
  function Tracker() {}
  Tracker.prototype.get = noop;
  Tracker.prototype.set = noop;
  Tracker.prototype.send = function () {
    var last = arguments[arguments.length - 1];
    if (last && typeof last.hitCallback === 'function') later(last.hitCallback);
  };
  function ga() {
    var last = arguments[arguments.length - 1];
    if (typeof last === 'function') {
      try { last(new Tracker()); } catch (e) { /* ignore */ }
    } else if (last && typeof last === 'object' && typeof last.hitCallback === 'function') {
      later(last.hitCallback);
    }
  }
  ga.create = function () { return new Tracker(); };
  ga.getByName = function () { return new Tracker(); };
  ga.getAll = function () { return [new Tracker()]; };
  ga.remove = noop;
  ga.loaded = true;
  var name = window.GoogleAnalyticsObject || 'ga';
  var queued = window[name] && window[name].q;
  window[name] = ga;
  if (Array.isArray(queued)) {
    queued.forEach(function (args) { try { ga.apply(null, args); } catch (e) { /* ignore */ } });
  }
  window._gaq = window._gaq || [];
  window._gaq.push = function (cmd) { if (typeof cmd === 'function') later(cmd); return 0; };
  window._gat = { _getTracker: function () { return { _trackPageview: noop, _trackEvent: noop }; } };

  var dl = window.dataLayer;
  if (dl && dl.hide && typeof dl.hide.end === 'function') {
    dl.hide.end();
    dl.hide.end = noop;
  }
  if (Array.isArray(dl)) {
    var handle = function (item) {
      if (item && typeof item.eventCallback === 'function') later(item.eventCallback);
      return dl.length;
    };
    dl.forEach(handle);
    dl.push = handle;
  }
})();
