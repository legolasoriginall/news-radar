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

// گروه ۱۸+ — فقط نشانی‌هایی که از Adult.m3u و AdultVod.m3u برداشته و در
// ۲۰۲۶-۱۱-۲۲ با دریافت فهرست پخش و نخستین سگمنت تأیید شده‌اند. مسیرهای بی‌پاسخ
// اصلاً در این فهرست نیستند و هیچ نشانی‌ای ساخته نشده است.
export const ADULT_CHANNELS = [
  {
    id: 'adult-anal',
    name: 'Anal',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/anal.m3u8'],
  },
  {
    id: 'adult-asian',
    name: 'Asian',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/asian.m3u8'],
  },
  {
    id: 'adult-big-ass',
    name: 'Big Ass',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/bigass.m3u8'],
  },
  {
    id: 'adult-big-dick',
    name: 'Big Dick',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/bigdick.m3u8'],
  },
  {
    id: 'adult-big-tits',
    name: 'Big Tits',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/bigtits.m3u8'],
  },
  {
    id: 'adult-blonde',
    name: 'Blonde',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/blonde.m3u8'],
  },
  {
    id: 'adult-blowjob',
    name: 'Blowjob',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/blowjob.m3u8'],
  },
  {
    id: 'adult-brunette',
    name: 'Brunette',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/brunette.m3u8'],
  },
  {
    id: 'adult-compilation',
    name: 'Compilation',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/compilation.m3u8'],
  },
  {
    id: 'adult-cuckold',
    name: 'Cuckold',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/cuckold.m3u8'],
  },
  {
    id: 'adult-fetish',
    name: 'Fetish',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/fetish.m3u8'],
  },
  {
    id: 'adult-gangbang',
    name: 'Gangbang',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/gangbang.m3u8'],
  },
  {
    id: 'adult-gay',
    name: 'Gay',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/gay.m3u8'],
  },
  {
    id: 'adult-hardcore',
    name: 'Hardcore',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/hardcore.m3u8'],
  },
  {
    id: 'adult-interracial',
    name: 'Interracial',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/interracial.m3u8'],
  },
  {
    id: 'adult-latina',
    name: 'Latina',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/latina.m3u8'],
  },
  {
    id: 'adult-lesbian',
    name: 'Lesbian',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/lesbian.m3u8'],
  },
  {
    id: 'adult-live-cams',
    name: 'Live Cams',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/livecams.m3u8'],
  },
  {
    id: 'adult-milf',
    name: 'MILF',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/milf.m3u8'],
  },
  {
    id: 'adult-mycamtv-anal',
    name: 'MyCamTV Anal',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/anal.m3u8'],
  },
  {
    id: 'adult-mycamtv-arab-girls',
    name: 'MyCamTV Arab Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/arab.m3u8'],
  },
  {
    id: 'adult-mycamtv-asian-girls',
    name: 'MyCamTV Asian Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/asian.m3u8'],
  },
  {
    id: 'adult-mycamtv-big-ass-girls',
    name: 'MyCamTV Big Ass Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/bigass.m3u8'],
  },
  {
    id: 'adult-mycamtv-blonde-girls',
    name: 'MyCamTV Blonde Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/blonde.m3u8'],
  },
  {
    id: 'adult-mycamtv-blowjob',
    name: 'MyCamTV Blowjob',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/blowjob.m3u8'],
  },
  {
    id: 'adult-mycamtv-brunette-girls',
    name: 'MyCamTV Brunette Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/brunette.m3u8'],
  },
  {
    id: 'adult-mycamtv-ebony-girls',
    name: 'MyCamTV Ebony Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/ebony.m3u8'],
  },
  {
    id: 'adult-mycamtv-girls-squirt',
    name: 'MyCamTV Girls Squirt',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/squirt.m3u8'],
  },
  {
    id: 'adult-mycamtv-latina-girls',
    name: 'MyCamTV Latina Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/latina.m3u8'],
  },
  {
    id: 'adult-mycamtv-mature',
    name: 'MyCamTV Mature',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/bigtits.m3u8'],
  },
  {
    id: 'adult-mycamtv-medium-girls',
    name: 'MyCamTV Medium Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/medium.m3u8'],
  },
  {
    id: 'adult-mycamtv-milf',
    name: 'MyCamTV MILF',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/milf.m3u8'],
  },
  {
    id: 'adult-mycamtv-skinny-girls',
    name: 'MyCamTV Skinny Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/skinny.m3u8'],
  },
  {
    id: 'adult-mycamtv-vod-1',
    name: 'MyCamTV VOD #1',
    group: '18+',
    watch: '',
    fallbacks: ['https://vod.mycamtv.net/1.m3u8'],
  },
  {
    id: 'adult-mycamtv-vod-100',
    name: 'MyCamTV VOD #100',
    group: '18+',
    watch: '',
    fallbacks: ['https://vod.mycamtv.net/100.m3u8'],
  },
  {
    id: 'adult-mycamtv-vod-1000',
    name: 'MyCamTV VOD #1000',
    group: '18+',
    watch: '',
    fallbacks: ['https://vod.mycamtv.net/1000.m3u8'],
  },
  {
    id: 'adult-mycamtv-vod-10000',
    name: 'MyCamTV VOD #10000',
    group: '18+',
    watch: '',
    fallbacks: ['https://vod.mycamtv.net/10000.m3u8'],
  },
  {
    id: 'adult-mycamtv-vod-14872',
    name: 'MyCamTV VOD #14872',
    group: '18+',
    watch: '',
    fallbacks: ['https://vod.mycamtv.net/14872.m3u8'],
  },
  {
    id: 'adult-mycamtv-vod-5000',
    name: 'MyCamTV VOD #5000',
    group: '18+',
    watch: '',
    fallbacks: ['https://vod.mycamtv.net/5000.m3u8'],
  },
  {
    id: 'adult-mycamtv-white-girls',
    name: 'MyCamTV White Girls',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.mycamtv.com/white.m3u8'],
  },
  {
    id: 'adult-pornstar',
    name: 'Pornstar',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/pornstar.m3u8'],
  },
  {
    id: 'adult-pov',
    name: 'POV',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/pov.m3u8'],
  },
  {
    id: 'adult-redtraffic-big-ass',
    name: 'RedTraffic Big Ass',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/bigass.m3u8'],
  },
  {
    id: 'adult-redtraffic-big-dick',
    name: 'RedTraffic Big Dick',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/bigdick.m3u8'],
  },
  {
    id: 'adult-redtraffic-big-tits',
    name: 'RedTraffic Big Tits',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/bigtits.m3u8'],
  },
  {
    id: 'adult-redtraffic-cuckold',
    name: 'RedTraffic Cuckold',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/cuckold.m3u8'],
  },
  {
    id: 'adult-redtraffic-fetish',
    name: 'RedTraffic Fetish',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/fetish.m3u8'],
  },
  {
    id: 'adult-redtraffic-hardcore',
    name: 'RedTraffic Hardcore',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/hardcore.m3u8'],
  },
  {
    id: 'adult-redtraffic-interracial',
    name: 'RedTraffic Interracial',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/interracial.m3u8'],
  },
  {
    id: 'adult-redtraffic-latina',
    name: 'RedTraffic Latina',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/latina.m3u8'],
  },
  {
    id: 'adult-redtraffic-lesbian',
    name: 'RedTraffic Lesbian',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/lesbian.m3u8'],
  },
  {
    id: 'adult-redtraffic-milf',
    name: 'RedTraffic MILF',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/milf.m3u8'],
  },
  {
    id: 'adult-redtraffic-pornstar',
    name: 'RedTraffic Pornstar',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/pornstar.m3u8'],
  },
  {
    id: 'adult-redtraffic-pov',
    name: 'RedTraffic POV',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/pov.m3u8'],
  },
  {
    id: 'adult-redtraffic-russian',
    name: 'RedTraffic Russian',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/russian.m3u8'],
  },
  {
    id: 'adult-redtraffic-teen',
    name: 'RedTraffic Teen',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/teen.m3u8'],
  },
  {
    id: 'adult-redtraffic-threesome',
    name: 'RedTraffic Threesome',
    group: '18+',
    watch: '',
    fallbacks: ['http://live.redtraffic.xyz/threesome.m3u8'],
  },
  {
    id: 'adult-rough',
    name: 'Rough',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/rough.m3u8'],
  },
  {
    id: 'adult-russian',
    name: 'Russian',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/russian.m3u8'],
  },
  {
    id: 'adult-threesome',
    name: 'Threesome',
    group: '18+',
    watch: '',
    fallbacks: ['http://cdn.adultiptv.net/threesome.m3u8'],
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
  channels = LIVE_CHANNELS.concat(ADULT_CHANNELS),
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
    const resolved = {
      id: channel.id,
      name: channel.name,
      watch: channel.watch || '',
      sources: healthy.length ? healthy : limited,
    };
    if (channel.group) resolved.group = channel.group;
    result.push(resolved);
  }

  return { channels: result, fetched_at: new Date().toISOString() };
}
