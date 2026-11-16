// پروکسی رسانه‌ای رصد خبر
// فقط GET/HEAD و فقط محتوای رسانه‌ای (HLS، ویدیو، صدا و تصویر) را عبور می‌دهد.
// منابع HTTP هم پشتیبانی می‌شوند چون برخی پلی‌لیست‌های IPTV فقط HTTP هستند.
// پلی‌لیست‌های HLS بازنویسی می‌شوند تا سگمنت‌ها هم از همین پروکسی عبور کنند.
// این Worker هیچ کوکی یا هدر احراز هویتی را به مقصد نمی‌فرستد.

const ALLOWED_MEDIA = /^(video\/|audio\/|image\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/octet-stream|binary\/octet-stream)/i;
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;
const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$/;
const CACHEABLE_EXT = /\.(ts|m4s|mp4|m4a|aac|key|jpg|jpeg|png|webp|gif|svg|avif)$/i;
const CACHE_TTL_SECONDS = 120;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60 * 1000;
const memoryRate = new Map();

function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Range, Content-Type',
    'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Proxy-Cache',
    ...extra,
  };
}

function fail(message, status = 400) {
  return new Response(message, {
    status,
    headers: corsHeaders({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }),
  });
}

function validTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443' && url.port !== '80') return null;
  const host = url.hostname.toLowerCase();
  if (IP_LITERAL.test(host) || host.includes(':') || PRIVATE_HOST.test(host)) return null;
  if (!host.includes('.')) return null;
  return url;
}

function proxyUrl(origin, target) {
  return `${origin}/?url=${encodeURIComponent(target)}`;
}

function rewritePlaylist(text, baseUrl, origin) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (line.startsWith('#')) {
        return line.replace(/URI="([^"]*)"/g, (match, uri) => {
          try {
            return `URI="${proxyUrl(origin, new URL(uri, baseUrl).href)}"`;
          } catch {
            return match;
          }
        });
      }
      try {
        return proxyUrl(origin, new URL(line.trim(), baseUrl).href);
      } catch {
        return line;
      }
    })
    .join('\n');
}

async function getCache() {
  try {
    if (typeof caches === 'undefined') return null;
    // در محیط Sites دسترسی به caches.default مجاز نیست؛ کش نام‌دار را
    // امتحان می‌کنیم و اگر آن هم مجاز نبود، کش حافظه‌ای جایگزین می‌شود.
    if (typeof caches.open === 'function') {
      try { return await caches.open('news-radar-media'); } catch { /* ادامه */ }
    }
    if (caches.default) return caches.default;
  } catch {
    // کش اختیاری است.
  }
  return null;
}

function clientIp(request) {
  // فقط هدری که خود Cloudflare تنظیم می‌کند قابل اعتماد است؛ X-Forwarded-For
  // را کلاینت می‌تواند جعل کند و محدودیت را دور بزند.
  const direct = request.headers.get('cf-connecting-ip');
  return direct ? direct.trim() : '';
}

// محدودیت نرخ ساده و تقریبی در هر نقطهٔ شبکه. برای پخش HLS (یک سگمنت هر
// چند ثانیه) سقف ۶۰۰ درخواست در دقیقه برای هر IP حدود ۲۰ بینندهٔ هم‌زمان
// پشت یک NAT را پوشش می‌دهد و جلوی مصرف انفجاری سهمیه را می‌گیرد.
async function isRateLimited(request, ctx) {
  const ip = clientIp(request);
  if (!ip) return false;
  const windowId = Math.floor(Date.now() / RATE_WINDOW_MS);
  const origin = new URL(request.url).origin;
  // یک کلید برای هر IP (نه یک کلید برای هر دقیقه) تا کش با هزاران کلید
  // کوچک پر نشود؛ مقدار، پنجرهٔ جاری و شمارنده را نگه می‌دارد.
  const key = new URL(`/__proxy_rate/${encodeURIComponent(ip)}`, origin).href;
  const cache = await getCache();
  if (cache) {
    try {
      const hit = await cache.match(key);
      const [savedWindow, savedCount] = hit ? (await hit.text()).split(':') : [];
      const count = savedWindow === String(windowId) ? Number(savedCount) || 0 : 0;
      if (count >= RATE_LIMIT) return true;
      const next = new Response(`${windowId}:${count + 1}`, {
        headers: {
          'content-type': 'text/plain',
          'cache-control': `max-age=${Math.ceil(RATE_WINDOW_MS / 1000) + 10}`,
        },
      });
      if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, next));
      else await cache.put(key, next);
      return false;
    } catch {
      // اگر Cache API در دسترس نبود، محدودیت حافظه‌ای همین ایزوله اعمال می‌شود.
    }
  }
  const memoryKey = `${ip}:${windowId}`;
  const count = memoryRate.get(memoryKey) || 0;
  if (count >= RATE_LIMIT) return true;
  memoryRate.set(memoryKey, count + 1);
  if (memoryRate.size > 2000) {
    for (const oldKey of memoryRate.keys()) {
      if (!oldKey.endsWith(`:${windowId}`)) memoryRate.delete(oldKey);
    }
  }
  return false;
}

function rateLimitResponse() {
  const retry = Math.max(1, Math.ceil((RATE_WINDOW_MS - (Date.now() % RATE_WINDOW_MS)) / 1000));
  return new Response('تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کن.', {
    status: 429,
    headers: corsHeaders({
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(retry),
      'x-ratelimit-limit': String(RATE_LIMIT),
      'x-ratelimit-remaining': '0',
      'x-ratelimit-window': String(RATE_WINDOW_MS / 1000),
    }),
  });
}

function cachedResponse(cached, method) {
  const headers = new Headers(cached.headers);
  headers.set('x-proxy-cache', 'HIT');
  headers.set('access-control-allow-origin', '*');
  // TTL اعلام‌شده به مرورگر را ثابت نگه می‌داریم؛ بعضی لبه‌ها کش داخلی را
  // با TTL بلندتری نگه می‌دارند و نباید آن را به کلاینت تحمیل کنند.
  headers.set('cache-control', `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=60`);
  return new Response(method === 'HEAD' ? null : cached.body, { status: cached.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail('فقط GET و HEAD مجاز است', 405);
    }
    if (incoming.pathname === '/health' || incoming.pathname === '/') {
      if (!incoming.searchParams.get('url')) {
        return new Response(JSON.stringify({ ok: true, service: 'news-radar-media-proxy' }), {
          headers: corsHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }),
        });
      }
    }

    if (await isRateLimited(request, ctx)) return rateLimitResponse();

    const target = validTarget(incoming.searchParams.get('url') || '');
    if (!target) {
      return fail('آدرس مقصد مجاز نیست؛ فقط HTTP/HTTPS بدون پورت غیراستاندارد پذیرفته می‌شود.', 400);
    }

    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      accept: '*/*',
    };
    const range = request.headers.get('range');
    if (range) headers.range = range;

    // سگمنت‌های HLS همیشه پسوند ندارند؛ برای همین هر GET بدون Range (به‌جز
    // پلی‌لیست‌های m3u8) واجد بررسی کش است و نوع رسانه بعد از پاسخ بررسی می‌شود.
    const looksLikePlaylist = /\.m3u8$/i.test(target.pathname);
    const cache = request.method === 'GET' && !range && !looksLikePlaylist ? await getCache() : null;
    const cacheKey = new Request(incoming.href, { method: 'GET' });
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) return cachedResponse(hit, request.method);
      } catch {
        // کش اختیاری است؛ در صورت خطا مستقیم از منبع خوانده می‌شود.
      }
    }

    let upstream;
    try {
      upstream = await fetch(target.href, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return fail('اتصال به منبع برقرار نشد', 502);
    }

    // بعد از تغییرمسیر هم مقصد باید همان قواعد را رعایت کند.
    const finalUrl = validTarget(upstream.url);
    if (!finalUrl) {
      try { upstream.body?.cancel(); } catch { /* ignore */ }
      return fail('منبع به مقصد غیرمجاز هدایت شد', 502);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8$/i.test(finalUrl.pathname);
    if (!upstream.ok) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: corsHeaders({ 'content-type': contentType, 'cache-control': 'no-store' }),
      });
    }

    if (isPlaylist) {
      const text = await upstream.text();
      if (!text.includes('#EXTM3U')) {
        return fail('پاسخ منبع یک پلی‌لیست HLS نیست', 502);
      }
      // پلی‌لیست زنده نباید کش شود؛ نسخهٔ VOD که ENDLIST دارد برای مرورگر
      // کوتاه‌مدت قابل کش است.
      const vod = text.includes('#EXT-X-ENDLIST');
      return new Response(rewritePlaylist(text, finalUrl.href, incoming.origin), {
        status: 200,
        headers: corsHeaders({
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': vod ? 'public, max-age=60' : 'no-store',
        }),
      });
    }

    if (!ALLOWED_MEDIA.test(contentType) && !CACHEABLE_EXT.test(finalUrl.pathname)) {
      try { upstream.body?.cancel(); } catch { /* ignore */ }
      return fail('نوع محتوای مقصد رسانه‌ای نیست', 415);
    }

    const out = corsHeaders({
      'content-type': contentType,
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=60`,
      'x-proxy-cache': cache ? 'MISS' : 'OFF',
    });
    for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) out[name] = value;
    }

    const response = new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: out,
    });

    const length = Number(upstream.headers.get('content-length') || 0);
    const cacheable = cache && upstream.status === 200 && !range && (!length || length <= MAX_CACHE_BYTES);
    if (cacheable) {
      try {
        const copy = response.clone();
        // نوشتن کش پس از پاسخ انجام می‌شود تا اولین سگمنت معطل ذخیره‌سازی نماند.
        if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, copy));
        else await cache.put(cacheKey, copy);
      } catch {
        // اگر کش پر یا غیرفعال باشد، پاسخ سالم به کاربر برمی‌گردد.
      }
    }
    return response;
  },
};
