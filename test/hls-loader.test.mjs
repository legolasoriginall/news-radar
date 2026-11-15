import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/hls-loader.js';

const { loadHlsWithFallback, isUsable } = globalThis.HlsLoader;

const LOCAL = 'vendor/hls.min.js?v=1.5.20';
const CDN_A = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
const CDN_B = 'https://updates.example.com/hls.min.js';

function fakeHls(version = '1.5.20') {
  return { isSupported: () => true, version };
}

/** ساعت ساختگی: هر فراخوانی یک مقدار ثابت از فهرست برمی‌گرداند. */
function clock(values) {
  const queue = values.slice();
  return () => {
    if (!queue.length) throw new Error('clock exhausted');
    return queue.shift();
  };
}

test('مسیر محلی اول انتخاب می‌شود و CDN اصلاً امتحان نمی‌شود', async () => {
  const calls = [];
  const Hls = fakeHls();
  const result = await loadHlsWithFallback({
    localUrl: LOCAL,
    cdnUrls: [CDN_A, CDN_B],
    injectScript: async (url, timeoutMs) => {
      calls.push({ url, timeoutMs });
      return Hls;
    },
    now: clock([1000, 1120]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, LOCAL);
  assert.equal(result.Hls, Hls);
  assert.equal(result.ms, 120);
  assert.deepEqual(calls.map((call) => call.url), [LOCAL]);
});

test('اگر فایل محلی خطا بدهد، CDN پشتیبان بارگذاری می‌شود', async () => {
  const calls = [];
  const fallbackCalls = [];
  const Hls = fakeHls();
  const result = await loadHlsWithFallback({
    localUrl: LOCAL,
    cdnUrls: [CDN_A],
    injectScript: async (url) => {
      calls.push(url);
      if (url === LOCAL) throw new Error('hls-script');
      return Hls;
    },
    onFallback: (attempt) => fallbackCalls.push(attempt),
    now: clock([10, 90, 100, 450]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, CDN_A);
  assert.equal(result.ms, 350);
  assert.deepEqual(calls, [LOCAL, CDN_A]);
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].ok, false);
  assert.equal(fallbackCalls[0].error, 'hls-script');
});

test('پاسخ نامعتبر از مسیر محلی (بدون isSupported) به معنی شکست است', async () => {
  const calls = [];
  const fallbackCalls = [];
  const Hls = fakeHls();
  const result = await loadHlsWithFallback({
    localUrl: LOCAL,
    cdnUrls: [CDN_A],
    injectScript: async (url) => {
      calls.push(url);
      return url === LOCAL ? {} : Hls;
    },
    onFallback: (attempt) => fallbackCalls.push(attempt),
    now: clock([0, 0, 0, 0]),
  });

  assert.equal(result.url, CDN_A);
  assert.deepEqual(calls, [LOCAL, CDN_A]);
  assert.equal(fallbackCalls[0].error, 'hls-unsupported');
});

test('اگر همهٔ مسیرها شکست بخورند، خطای hls-all-sources-failed با فهرست تلاش‌ها برمی‌گردد', async () => {
  const calls = [];
  await assert.rejects(
    loadHlsWithFallback({
      localUrl: LOCAL,
      cdnUrls: [CDN_A, CDN_B],
      injectScript: async (url) => {
        calls.push(url);
        if (url === CDN_A) throw new Error('hls-timeout');
        throw new Error('hls-script');
      },
      now: () => 500,
    }),
    (error) => {
      assert.equal(error.message, 'hls-all-sources-failed');
      assert.equal(error.attempts.length, 3);
      assert.deepEqual(error.attempts.map((attempt) => attempt.url), [LOCAL, CDN_A, CDN_B]);
      assert.deepEqual(error.attempts.map((attempt) => attempt.error), ['hls-script', 'hls-timeout', 'hls-script']);
      assert.deepEqual(calls, [LOCAL, CDN_A, CDN_B]);
      return true;
    }
  );
});

test('ترتیب CDNها حفظ می‌شود و اولین مسیر سالم برنده است', async () => {
  const calls = [];
  const Hls = fakeHls();
  const result = await loadHlsWithFallback({
    localUrl: LOCAL,
    cdnUrls: [CDN_A, CDN_B],
    injectScript: async (url) => {
      calls.push(url);
      if (url === LOCAL) throw new Error('hls-script');
      if (url === CDN_A) return { version: 'broken' };
      return Hls;
    },
    now: clock([0, 0, 0, 0, 0, 0]),
  });

  assert.equal(result.url, CDN_B);
  assert.deepEqual(calls, [LOCAL, CDN_A, CDN_B]);
});

test('مهلت‌های پیش‌فرض و سفارشی به لودر اسکریپت می‌رسند', async () => {
  const defaultTimeouts = [];
  await assert.rejects(loadHlsWithFallback({
    localUrl: LOCAL,
    cdnUrls: [CDN_A],
    injectScript: async (url, timeoutMs) => {
      defaultTimeouts.push(timeoutMs);
      throw new Error('hls-script');
    },
    now: () => 0,
  }), /hls-all-sources-failed/);
  assert.deepEqual(defaultTimeouts, [6000, 8000]);

  const customTimeouts = [];
  await assert.rejects(loadHlsWithFallback({
    localUrl: LOCAL,
    cdnUrls: [CDN_A],
    localTimeoutMs: 1500,
    cdnTimeoutMs: 2500,
    injectScript: async (url, timeoutMs) => {
      customTimeouts.push(timeoutMs);
      throw new Error('hls-script');
    },
    now: () => 0,
  }), /hls-all-sources-failed/);
  assert.deepEqual(customTimeouts, [1500, 2500]);
});

test('بدون لودر اسکریپت، خطای مشخص می‌دهد و isUsable را درست تشخیص می‌دهد', async () => {
  await assert.rejects(loadHlsWithFallback({ localUrl: LOCAL, cdnUrls: [CDN_A] }), /hls-inject-missing/);
  assert.equal(isUsable(fakeHls()), true);
  assert.equal(isUsable({}), false);
  assert.equal(isUsable(null), false);
});

test('تابع onFallback خطادار، روند بارگذاری را نمی‌شکند', async () => {
  const Hls = fakeHls();
  const result = await loadHlsWithFallback({
    localUrl: LOCAL,
    cdnUrls: [CDN_A],
    injectScript: async (url) => {
      if (url === LOCAL) throw new Error('hls-script');
      return Hls;
    },
    onFallback: () => { throw new Error('ui boom'); },
    now: () => 0,
  });
  assert.equal(result.url, CDN_A);
});
