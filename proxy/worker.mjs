// پروکسی رسانه‌ای رصد خبر
// فقط GET/HEAD و فقط محتوای رسانه‌ای (HLS، ویدیو، صدا و تصویر) را عبور می‌دهد.
// منابع HTTP هم پشتیبانی می‌شوند چون برخی پلی‌لیست‌های IPTV فقط HTTP هستند.
// پلی‌لیست‌های HLS بازنویسی می‌شوند تا سگمنت‌ها هم از همین پروکسی عبور کنند.
// این Worker هیچ کوکی یا هدر احراز هویتی را به مقصد نمی‌فرستد.

const ALLOWED_MEDIA = /^(video\/|audio\/|image\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/octet-stream|binary\/octet-stream)/i;
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;
const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$/;

function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Range, Content-Type',
    'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
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

export default {
  async fetch(request) {
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

    const target = validTarget(incoming.searchParams.get('url') || '');
    if (!target) {
      return fail('آدرس مقصد مجاز نیست؛ فقط HTTPS بدون پورت غیراستاندارد پذیرفته می‌شود.', 400);
    }

    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      accept: '*/*',
    };
    const range = request.headers.get('range');
    if (range) headers.range = range;

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
      return new Response(rewritePlaylist(text, finalUrl.href, incoming.origin), {
        status: 200,
        headers: corsHeaders({
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': 'no-store',
        }),
      });
    }

    if (!ALLOWED_MEDIA.test(contentType) && !/\.(ts|m4s|mp4|m4a|aac|key|jpg|jpeg|png|webp|gif|svg|avif)$/i.test(finalUrl.pathname)) {
      try { upstream.body?.cancel(); } catch { /* ignore */ }
      return fail('نوع محتوای مقصد رسانه‌ای نیست', 415);
    }

    const out = corsHeaders({
      'content-type': contentType,
      'cache-control': 'public, max-age=120',
    });
    for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) out[name] = value;
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: out,
    });
  },
};
