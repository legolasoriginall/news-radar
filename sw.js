/* سرویس‌ورکر رصد خبر
 * هدف: بازدید دوباره روی اتصال کند (ایران) بدون رفت‌وبرگشت اضافه باز شود.
 * - فایل داده (feed.json، detail/*.json و data.json محلی) با «تازه‌سازی در پس‌زمینه» از دیسک خوانده می‌شود؛
 *   یعنی صفحه فوراً با نسخهٔ ذخیره‌شده بالا می‌آید و نسخهٔ تازه در پس‌زمینه جایگزین می‌شود.
 * - خود صفحه (ناوبری) از شبکه و با بازپرسی شرطی می‌آید تا انتشار تازه دیده شود،
 *   و اگر شبکه نبود نسخهٔ ذخیره‌شده نمایش داده می‌شود.
 * نام کش‌ها با نام مخزن شروع می‌شود چون دامنهٔ github.io بین همهٔ پروژه‌ها مشترک است.
 */
const VERSION = 'news-radar-v6';
const SHELL_CACHE = VERSION + '-shell';
const DATA_CACHE = VERSION + '-data';

const BASE = self.registration.scope; // مثلاً https://user.github.io/news-radar/
const SHELL_FILES = ['index.html', 'admin.html', 'status.html'];
const SHELL_URLS = SHELL_FILES.map(function (name) { return new URL(name, BASE).href; });
const DATA_FILES = [
  new URL('feed.json', BASE).pathname,
  new URL('telegram.json', BASE).pathname,
  new URL('data.json', BASE).pathname,
  new URL('health.json', BASE).pathname,
  new URL('summary.json', BASE).pathname
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shellCache = await caches.open(SHELL_CACHE);
    try { await shellCache.addAll(SHELL_URLS); } catch (e) { /* بخشی کش نشد؛ درخواست‌های بعدی جبران می‌کنند */ }
    const dataCache = await caches.open(DATA_CACHE);
    const lightData = [
      new URL('health.json', BASE).href,
      new URL('summary.json', BASE).href,
      new URL('telegram.json', BASE).href
    ];
    try { await dataCache.addAll(lightData); } catch (e) { /* بخشی کش نشد */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      if (name.indexOf('news-radar-') === 0 && name !== SHELL_CACHE && name !== DATA_CACHE) {
        return caches.delete(name);
      }
      return null;
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // میزبان‌های دیگر دست‌نخورده می‌مانند
  // مسیرهای پویا کش نمی‌شوند
  if (url.pathname.indexOf('/api/') !== -1) return;

  // جزئیات هر خبر فایل مستقل است و فقط با باز کردن «جزئیات» درخواست می‌شود.
  if (DATA_FILES.indexOf(url.pathname) !== -1 || /\/feed-more-\d+\.json$/.test(url.pathname) ||
    /\/detail\/[^/]+\.json$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, url));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(event, url));
  }
});

async function networkFirstDocument(event, url) {
  const cache = await caches.open(SHELL_CACHE);
  const key = url.origin + url.pathname;
  try {
    // بازپرسی شرطی: اگر صفحه عوض نشده باشد پاسخ ۳۰۴ بدون بدنه می‌آید.
    const fresh = await fetch(event.request.url, { cache: 'no-cache' });
    if (fresh.ok && !fresh.redirected) cache.put(key, fresh.clone()).catch(() => {});
    return fresh;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>بدون اتصال</title>' +
      '<p style="font-family:Tahoma,sans-serif;direction:rtl;padding:24px">این صفحه هنوز در این دستگاه ذخیره نشده و اتصال هم برقرار نیست.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
}

function staleWhileRevalidate(event, url) {
  const key = url.origin + url.pathname;
  const network = (async () => {
    const fresh = await fetch(url.href, { cache: 'no-cache' });
    if (!fresh.ok || fresh.redirected) return fresh;
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(key);
    const changed = !cached ||
      cached.headers.get('etag') !== fresh.headers.get('etag') ||
      cached.headers.get('last-modified') !== fresh.headers.get('last-modified');
    await cache.put(key, fresh.clone());
    if (changed && cached) broadcast({ type: 'feed-updated' });
    return fresh;
  })();

  // بدون waitUntil ممکن است ورکر پیش از نوشتن کش متوقف شود
  event.waitUntil(network.catch(() => {}));

  return (async () => {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(key);
    if (cached) return cached;
    return network;
  })();
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => {
    try { client.postMessage(message); } catch (e) { /* پنجرهٔ بسته */ }
  });
}
