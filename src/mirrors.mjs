// آینه‌های خودکار برای فیدهای خبری
// وقتی دامنهٔ یک منبع قطع یا مسیر فید عوض شده باشد، به‌ترتیب این مسیرها امتحان می‌شوند:
//   ۱) مسیر ذخیره‌شده از اجرای قبل (اگر قبلاً آینه‌ای جواب داده باشد)
//   ۲) همان دامنه با مسیر/پروتکل جایگزین (مثلاً /rss ↔ /rss/ ↔ /rss.xml و http ↔ https)
//   ۳) اسنپ‌شات آرشیو اینترنتی از همان فید
// هر پاسخ پیش از پذیرش اعتبارسنجی می‌شود تا صفحهٔ HTML یا صفحهٔ خطا به‌جای خوراک خوانده نشود.

export const FEED_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8';

/** آیا متن دریافتی واقعاً خوراک RSS/Atom/RDF است؟ */
export function isFeedXml(text) {
  const head = String(text || '').slice(0, 4000);
  return /<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<rdf:RDF[\s>]/i.test(head);
}

/** مسیرها و پروتکل‌های جایگزین روی همان میزبان. */
export function alternateFeedUrls(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return [];
  }
  if (!/^https?:$/.test(parsed.protocol)) return [];
  const original = parsed.href;
  const out = new Set();
  const add = (mutate) => {
    const next = new URL(original);
    mutate(next);
    if (next.href !== original) out.add(next.href);
  };

  add((next) => {
    next.protocol = next.protocol === 'https:' ? 'http:' : 'https:';
  });
  add((next) => {
    next.pathname = next.pathname.endsWith('/')
      ? next.pathname.replace(/\/+$/, '') || '/'
      : `${next.pathname}/`;
  });
  if (/\.xml$/i.test(parsed.pathname)) {
    add((next) => {
      next.pathname = next.pathname.replace(/\.xml$/i, '');
    });
  } else if (!/\.[a-z0-9]{2,5}$/i.test(parsed.pathname) && !parsed.pathname.endsWith('/')) {
    add((next) => {
      next.pathname = `${next.pathname}.xml`;
    });
  }
  if (/\/rss$/i.test(parsed.pathname)) {
    add((next) => {
      next.pathname = `${next.pathname}.xml`;
    });
  }
  return [...out];
}

/** فهرست کامل آینه‌ها به‌ترتیب اولویت. */
export function feedMirrors(url, cached = '') {
  const list = [];
  if (cached && cached !== url) list.push(cached);
  list.push(...alternateFeedUrls(url));
  return [...new Set(list)].filter((item) => item !== url);
}

async function fetchText(fetcher, url, timeoutMs) {
  const response = await fetcher(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': FEED_USER_AGENT, Accept: FEED_ACCEPT, 'Accept-Language': 'fa,en;q=0.8' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** نشانی خام جدیدترین اسنپ‌شات آرشیو برای یک فید؛ اگر نسخهٔ سالمی نبود رشتهٔ خالی. */
export async function waybackMirror(url, { fetcher = fetch, timeoutMs = 15000 } = {}) {
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  let payload;
  try {
    const response = await fetcher(api, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return '';
    payload = await response.json();
  } catch {
    return '';
  }
  const closest = payload?.archived_snapshots?.closest;
  if (!closest?.available || !/^2\d\d$/.test(String(closest.status || ''))) return '';
  const timestamp = String(closest.timestamp || '').replace(/\D/g, '');
  if (!timestamp) return '';
  // id_ نسخهٔ خام و بدون نوار ابزار آرشیو را برمی‌گرداند.
  return `https://web.archive.org/web/${timestamp}id_/${url}`;
}

/**
 * خواندن فید از آینه‌ها، بعد از این‌که مسیر اصلی (در پایپ‌لاین) جواب نداد.
 * خروجی: { ok, xml, via, attempts, error }
 */
export async function fetchFeedWithMirrors({
  url,
  cached = '',
  fetcher = fetch,
  timeoutMs = 20000,
  validate = isFeedXml,
  tryWayback: allowWayback = true,
} = {}) {
  const attempts = [];
  const tried = new Set([url]);

  const attempt = async (candidate) => {
    if (tried.has(candidate)) return '';
    tried.add(candidate);
    try {
      const text = await fetchText(fetcher, candidate, timeoutMs);
      if (!validate(text)) throw new Error('پاسخ خوراک معتبر نبود');
      return text;
    } catch (error) {
      attempts.push({ url: candidate, error: String(error?.message || error) });
      return '';
    }
  };

  for (const candidate of feedMirrors(url, cached)) {
    // eslint-disable-next-line no-await-in-loop
    const xml = await attempt(candidate);
    if (xml) return { ok: true, xml, via: candidate, attempts, error: '' };
  }

  if (allowWayback) {
    const snapshot = await waybackMirror(url, { fetcher, timeoutMs: Math.min(timeoutMs, 15000) });
    if (snapshot) {
      const xml = await attempt(snapshot);
      if (xml) return { ok: true, xml, via: snapshot, attempts, error: '' };
    } else {
      attempts.push({ url: 'archive.org', error: 'اسنپ‌شات سالمی پیدا نشد' });
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    xml: '',
    via: '',
    attempts,
    error: last ? `${last.error} (${attempts.length} مسیر امتحان شد)` : 'مسیر جایگزینی پاسخ نداد',
  };
}
