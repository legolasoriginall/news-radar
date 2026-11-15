// منابع پخش زندهٔ شبکه‌های فارسی
// فهرست پخش‌های عمومی (iptv-org) به‌صورت دوره‌ای خوانده و با منابع پیش‌فرض ترکیب می‌شود تا
// اگر یک مسیر از دسترس خارج شد، مسیرهای تازه جای آن را بگیرند. هر مسیر پیش از تحویل،
// یک بار بررسی می‌شود و مسیرهای سالم اول فهرست می‌آیند.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// tvg-id در فهرست‌های عمومی ممکن است پسوند کیفیت داشته باشد (مثلاً IranInternational.uk@SD)
export const LIVE_CHANNELS = [
  {
    id: 'iranintl',
    name: 'ایران اینترنشنال',
    tvg_ids: ['iraninternational.uk', 'iraninternational.us'],
    name_match: ['iran international', 'iranintl'],
    watch: 'https://www.iranintl.com/live',
    fallbacks: [
      'https://hlspackager.akamaized.net/live/DB/IRAN_INTERNATIONAL/HLS/IRAN_INTERNATIONAL.m3u8',
      'https://live.livetvstream.co.uk/LS-63503-4/index.m3u8',
      'https://dev-live.livetvstream.co.uk/LS-63503-4/index.m3u8',
      'https://dev-live.livetvstream.co.uk/LS-63503-4/chunklist_b1196000.m3u8',
    ],
  },
  {
    id: 'voa',
    name: 'صدای آمریکا',
    tvg_ids: ['voatvpersian.us', 'voapersian.us'],
    name_match: ['voa persian', 'voa tv persian'],
    watch: '',
    fallbacks: [
      'https://voa-ingest.akamaized.net/hls/live/2033876/tvmc07/playlist.m3u8',
      'https://voa-ingest.akamaized.net/hls/live/2033876/tvmc07/playlist_1080.m3u8',
    ],
  },
  {
    id: 'radiofarda',
    name: 'رادیو فردا',
    tvg_ids: ['radiofarda.us', 'radiofardatv.us'],
    name_match: ['radio farda', 'radio farda tv'],
    watch: 'https://www.radiofarda.com/live',
    fallbacks: [
      'https://rferl-ingest.akamaized.net/hls/live/2121768/tvmc01/playlist.m3u8',
      'https://rfe-ingest.akamaized.net/hls/live/2033042/tvmc01/playlist.m3u8',
      'https://rfe-ingest.akamaized.net/hls/live/2035292/axia21/playlist.m3u8',
    ],
  },
  {
    id: 'yourtime',
    name: 'YourTime HD',
    tvg_ids: ['YourTimeTV.ir', 'YourTime.ir'],
    name_match: ['yourtime', 'your time'],
    watch: 'https://yourtime.tv/',
    fallbacks: [
      'https://live.yourtime.tv/hls/stream.m3u8',
    ],
  },
];

// برای هر مسیر iptv-org چند آینه داریم؛ اگر GitHub Pages در دسترس نبود، همان فایل
// از jsDelivr (دو دامنهٔ جدا)، raw.githack یا GitHub Raw (شاخهٔ gh-pages) خوانده می‌شود
// تا فهرست شبکه‌ها نیفتد. هر مسیر در زمان نوشتن با دریافت واقعی فایل آزمایش شده است.
export const IPTV_MIRROR_BASES = [
  'https://iptv-org.github.io/iptv',
  'https://cdn.jsdelivr.net/gh/iptv-org/iptv@gh-pages',
  'https://fastly.jsdelivr.net/gh/iptv-org/iptv@gh-pages',
  'https://raw.githack.com/iptv-org/iptv/gh-pages',
  'https://raw.githubusercontent.com/iptv-org/iptv/gh-pages',
];

/** نشانی‌های آینهٔ یک فایل iptv-org، به‌ترتیب اولویت. */
export function iptvMirrors(playlistPath) {
  const relative = String(playlistPath || '').replace(/^\/+/, '');
  return IPTV_MIRROR_BASES.map((base) => `${base}/${relative}`);
}

// جدا از iptv-org، فهرست‌های مستقل فارسی هم خوانده می‌شوند تا فقط به یک ارائه‌دهنده
// وابسته نباشیم؛ هر کدام نبود، بقیه ادامه می‌دهند.
export const LIVE_PLAYLISTS = [
  iptvMirrors('languages/fas.m3u'),
  ['https://raw.githubusercontent.com/shayanline/iptv-iran/main/playlists/en/iran.m3u'],
  ['https://raw.githubusercontent.com/shahram7/iranianiptv/main/playlist.m3u'],
  ['https://raw.githubusercontent.com/mehrdad-dd/myiptv/main/core.m3u'],
  ['https://raw.githubusercontent.com/Siamakeo/IPTV/master/Playlist.m3u'],
  iptvMirrors('index.m3u'),
];

/** خطوط EXTINF یک فهرست m3u را به رکوردهای { tvgId, name, url } تبدیل می‌کند. */
export function parsePlaylist(text) {
  const items = [];
  let pending = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const idMatch = line.match(/tvg-id="([^"]*)"/i);
      pending = {
        tvgId: idMatch ? idMatch[1].trim() : '',
        name: line.slice(line.lastIndexOf(',') + 1).trim(),
        url: '',
      };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!pending) continue;
    pending.url = line;
    items.push(pending);
    pending = null;
  }
  return items;
}

function normalizeId(value) {
  return String(value ?? '').split('@')[0].trim().toLowerCase();
}

// فهرست‌های مستقل اغلب tvg-id ندارند؛ نام هم برای تطبیق به کار می‌رود.
function normalizeName(value) {
  return String(value ?? '').toLowerCase()
    .replace(/\b(fhd|uhd|hd|sd|hq|4k|8k)\b/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
    .trim();
}

/** نشانی‌های HLS یک کانال را از رکوردهای فهرست بیرون می‌کشد (بدون تکرار، بدون DASH). */
export function selectSources(entries, channel) {
  const wanted = new Set((channel.tvg_ids || []).map(normalizeId));
  const wantedNames = new Set((channel.name_match || [channel.name]).map(normalizeName));
  const urls = [];
  for (const entry of entries) {
    const byId = wanted.has(normalizeId(entry.tvgId));
    const byName = !byId && wantedNames.has(normalizeName(entry.name));
    if (!byId && !byName) continue;
    if (!/^https?:\/\//i.test(entry.url)) continue;
    if (!/\.m3u8(\?|$)/i.test(entry.url)) continue;
    if (!urls.includes(entry.url)) urls.push(entry.url);
  }
  return urls;
}

/** یک نشانی را بررسی می‌کند که واقعاً یک فهرست پخش HLS برگرداند. */
export async function probeStream(url, { fetcher = fetch, timeoutMs = 6000 } = {}) {
  try {
    const response = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = await response.text();
    return body.includes('#EXTM3U');
  } catch {
    return false;
  }
}

// هر ورودی یک فهرست یا گروهی از آینه‌هاست؛ آینه‌ها به‌ترتیب امتحان می‌شوند و
// فقط اولین پاسخ سالم خوانده می‌شود تا ترافیک تکراری ساخته نشود.
async function readPlaylists({ fetcher, playlists, timeoutMs }) {
  const groups = playlists.map((item) => (Array.isArray(item) ? item : [item]));
  const results = await Promise.all(
    groups.map(async (group) => {
      for (const url of group) {
        try {
          const response = await fetcher(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return parsePlaylist(await response.text());
        } catch {
          // آینهٔ بعدی امتحان می‌شود
        }
      }
      return [];
    })
  );
  return results.flat();
}

/**
 * فهرست کانال‌های زنده را با منابع تازه می‌سازد.
 * منابع سالم اول می‌آیند؛ اگر هیچ مسیری سالم نبود، همان فهرست پیش‌فرض برگردانده می‌شود
 * تا سمت مرورگر خودش مسیرها را امتحان کند.
 */
export async function resolveLiveChannels({
  channels = LIVE_CHANNELS,
  playlists = LIVE_PLAYLISTS,
  fetcher = fetch,
  probe = probeStream,
  timeoutMs = 6000,
  maxSources = 6,
} = {}) {
  const entries = await readPlaylists({ fetcher, playlists, timeoutMs: Math.max(timeoutMs, 15000) });
  const result = [];

  for (const channel of channels) {
    const discovered = selectSources(entries, channel);
    const candidates = [];
    for (const url of [...discovered, ...(channel.fallbacks || [])]) {
      if (url && !candidates.includes(url)) candidates.push(url);
    }
    const limited = candidates.slice(0, Math.max(1, maxSources));
    const checks = await Promise.all(
      limited.map(async (url) => ({ url, ok: await probe(url, { fetcher, timeoutMs }) }))
    );
    const healthy = checks.filter((check) => check.ok).map((check) => check.url);
    result.push({
      id: channel.id,
      name: channel.name,
      watch: channel.watch || '',
      sources: healthy.length ? healthy : limited,
    });
  }

  return { channels: result, fetched_at: new Date().toISOString() };
}
