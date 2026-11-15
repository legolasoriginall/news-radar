// انتخاب مسیر hls.js: اول فایل خود سایت، بعد CDNهای پشتیبان.
// این فایل هم به‌صورت اسکریپت کلاسیک در مرورگر بارگذاری می‌شود (window.HlsLoader)
// و هم در تست‌های Node بدون دستکاری DOM import می‌شود.
(function (root) {
  'use strict';

  var LOCAL_TIMEOUT_MS = 6000;
  var CDN_TIMEOUT_MS = 8000;

  function isUsable(Hls) {
    return Boolean(Hls && typeof Hls.isSupported === 'function');
  }

  /**
   * بارگذاری hls.js با انتخاب مسیر محلی و سپس مسیرهای پشتیبان.
   * ورودی: { localUrl, cdnUrls, injectScript(url, timeoutMs), localTimeoutMs, cdnTimeoutMs, now, onFallback }
   * خروجی موفق: { ok: true, url, Hls, ms }
   * خروجی ناموفق: Error با message = 'hls-all-sources-failed' و آرایهٔ attempts
   */
  async function loadHlsWithFallback(options) {
    var opts = options || {};
    var localUrl = String(opts.localUrl || '');
    var cdnUrls = Array.isArray(opts.cdnUrls) ? opts.cdnUrls.slice() : [];
    var injectScript = opts.injectScript;
    var now = typeof opts.now === 'function' ? opts.now : Date.now;
    var localTimeoutMs = Number(opts.localTimeoutMs) || LOCAL_TIMEOUT_MS;
    var cdnTimeoutMs = Number(opts.cdnTimeoutMs) || CDN_TIMEOUT_MS;
    var attempts = [];

    if (typeof injectScript !== 'function') {
      throw new Error('hls-inject-missing');
    }

    async function tryUrl(url, timeoutMs) {
      var started = now();
      try {
        var Hls = await injectScript(url, timeoutMs);
        var ms = now() - started;
        if (!isUsable(Hls)) return { ok: false, url: url, ms: ms, error: 'hls-unsupported' };
        return { ok: true, url: url, Hls: Hls, ms: ms };
      } catch (error) {
        return {
          ok: false,
          url: url,
          ms: now() - started,
          error: String((error && error.message) || 'hls-script'),
        };
      }
    }

    var local = await tryUrl(localUrl, localTimeoutMs);
    attempts.push(local);
    if (local.ok) return local;

    if (typeof opts.onFallback === 'function') {
      try { opts.onFallback(local); } catch (error) { /* پیام وضعیت نباید بارگذاری را بشکند */ }
    }

    for (var i = 0; i < cdnUrls.length; i += 1) {
      var attempt = await tryUrl(cdnUrls[i], cdnTimeoutMs);
      attempts.push(attempt);
      if (attempt.ok) return attempt;
    }

    var failure = new Error('hls-all-sources-failed');
    failure.attempts = attempts;
    throw failure;
  }

  var api = { loadHlsWithFallback: loadHlsWithFallback, isUsable: isUsable };

  if (root) root.HlsLoader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
