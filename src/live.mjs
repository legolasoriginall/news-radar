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
    watch: 'https://www.iranintl.com/live',
    fallbacks: [
      'https://hlspackager.akamaized.net/live/DB/IRAN_INTERNATIONAL/HLS/IRAN_INTERNATIONAL.m3u8',
      'https://live.livetvstream.co.uk/LS-63503-4/index.m3u8',
      'https://dev-live.livetvstream.co.uk/LS-63503-4/index.m3u8',
    ],
  },
  {
    id: 'voa',
    name: 'صدای آمریکا',
    tvg_ids: ['voatvpersian.us', 'voapersian.us'],
    watch: '',
    fallbacks: ['https://voa-ingest.akamaized.net/hls/live/2033876/tvmc07/playlist.m3u8'],
  },
  {
    id: 'radiofarda',
    name: 'رادیو فردا',
    tvg_ids: ['radiofarda.us', 'radiofardatv.us'],
    watch: 'https://www.radiofarda.com/live',
    fallbacks: ['https://rfe-ingest.akamaized.net/hls/live/2033042/tvmc01/playlist.m3u8'],
  },
];

export const LIVE_PLAYLISTS = [
  'https://iptv-org.github.io/iptv/languages/fas.m3u',
  'https://raw.githubusercontent.com/Siamakeo/IPTV/master/Playlist.m3u',
  'https://iptv-org.github.io/iptv/index.m3u',
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

/** نشانی‌های HLS یک کانال را از رکوردهای فهرست بیرون می‌کشد (بدون تکرار، بدون DASH). */
export function selectSources(entries, channel) {
  const wanted = new Set((channel.tvg_ids || []).map(normalizeId));
  const urls = [];
  for (const entry of entries) {
    if (!wanted.has(normalizeId(entry.tvgId))) continue;
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

async function readPlaylists({ fetcher, playlists, timeoutMs }) {
  const settled = await Promise.allSettled(
    playlists.map(async (url) => {
      const response = await fetcher(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
  );
  return settled.filter((result) => result.status === 'fulfilled').flatMap((result) => parsePlaylist(result.value));
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
