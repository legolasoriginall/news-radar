// کانال‌های تلگرام رسانه‌های فارسی‌زبان خارج از ایران
// پست‌ها از پیش‌نمایش عمومی کانال‌ها (t.me/s/...) خوانده می‌شوند: بدون توکن، بدون عضویت و
// بدون نیاز به ادمین‌بودن ربات. هر پست با فاصلهٔ چند ثانیه از انتشار در کانال قابل خواندن است.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// کانال‌هایی که پیش‌نمایش عمومی‌شان فعال است و در روزهای اخیر پست داشته‌اند
export const TELEGRAM_CHANNELS = [
  { id: 'iranintl_tv', handle: 'IranintlTV', name: 'ایران اینترنشنال', label: 'ایران اینترنشنال (تلگرام)', weight: 0.8 },
  { id: 'bbc_persian_tv', handle: 'bbcpersian', name: 'بی‌بی‌سی فارسی', label: 'بی‌بی‌سی فارسی (تلگرام)', weight: 0.82 },
  { id: 'radiofarda_tv', handle: 'radiofarda', name: 'رادیو فردا', label: 'رادیو فردا (تلگرام)', weight: 0.78 },
  { id: 'dw_persian_tv', handle: 'dw_farsi', name: 'دویچه‌وله فارسی', label: 'دویچه‌وله فارسی (تلگرام)', weight: 0.76 },
  { id: 'indypersian_tv', handle: 'indypersian', name: 'ایندیپندنت فارسی', label: 'ایندیپندنت فارسی (تلگرام)', weight: 0.74 },
  { id: 'manoto_tv', handle: 'manototv', name: 'منوتو', label: 'منوتو (تلگرام)', weight: 0.7 },
];

/** کانال تازه (از پنل مدیر) را به فهرست اضافه می‌کند؛ تکراری‌ها به‌روز می‌شوند. */
export function addTelegramChannel(channel) {
  if (!channel || !channel.handle) return null;
  const index = TELEGRAM_CHANNELS.findIndex(
    (item) => item.id === channel.id || item.handle.toLowerCase() === String(channel.handle).toLowerCase()
  );
  if (index >= 0) {
    TELEGRAM_CHANNELS[index] = { ...TELEGRAM_CHANNELS[index], ...channel, id: TELEGRAM_CHANNELS[index].id };
    return TELEGRAM_CHANNELS[index];
  }
  TELEGRAM_CHANNELS.push(channel);
  return channel;
}

/** کانال اختصاصی (افزوده‌شده از پنل) را برمی‌دارد. */
export function removeTelegramChannel(id) {
  const index = TELEGRAM_CHANNELS.findIndex((item) => item.id === id);
  if (index === -1 || !TELEGRAM_CHANNELS[index].custom) return false;
  TELEGRAM_CHANNELS.splice(index, 1);
  return true;
}

// سازگاری با نسخهٔ قبلی که فقط کانال ایران اینترنشنال را می‌شناخت
export const TELEGRAM_CHANNEL = TELEGRAM_CHANNELS[0].handle;
export const TELEGRAM_CHANNEL_URL = `https://t.me/${TELEGRAM_CHANNEL}`;
export const TELEGRAM_PREVIEW_URL = `https://t.me/s/${TELEGRAM_CHANNEL}`;

/** منبع تلگرام هر کانال، برای ادغام پست‌ها در خوراک خبرها و خوشه‌بندی. */
export function telegramSource(channel) {
  return {
    id: channel.id,
    name: channel.label,
    lang: 'fa',
    weight: channel.weight ?? 0.7,
    origin: 'foreign',
  };
}

// سازگاری با نسخهٔ قبلی
export const TELEGRAM_SOURCE = telegramSource(TELEGRAM_CHANNELS[0]);

/** پیوند سایت ایران اینترنشنال را یکسان می‌کند تا با همان خبر در خوراک RSS یکی شود. */
export function normalizeTelegramLink(link) {
  const url = String(link ?? '').trim();
  if (!url) return '';
  return url.replace(/^https?:\/\/(?:www\.)?iranintl\.com\//i, 'https://www.iranintl.com/');
}

/** عنوان کوتاه پست از نخستین خط متن آن (برای نمایش و خوشه‌بندی). */
export function telegramPostTitle(post) {
  const text = String(post?.text ?? '').replace(/\r/g, '').trim();
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) || '';
  if (!firstLine) return 'پست تلگرام';
  return firstLine.length > 180 ? `${firstLine.slice(0, 177).replace(/[\s،,.:؛-]+$/, '')}…` : firstLine;
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  zwnj: '\u200c',
};

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    })
    .replace(/&#(\d+);/g, (match, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

/** متن پست را از HTML تلگرام به متن ساده تبدیل می‌کند (خط‌های تازه حفظ می‌شوند). */
export function telegramHtmlToText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectMedia(block) {
  if (/video_player|<video/i.test(block)) return 'video';
  if (/tgme_widget_message_photo_wrap/i.test(block)) return 'photo';
  if (/tgme_widget_message_document_wrap/i.test(block)) return 'document';
  if (/tgme_widget_message_voice/i.test(block)) return 'voice';
  if (/tgme_widget_message_roundvideo/i.test(block)) return 'video_note';
  return null;
}

/** نخستین نشانی http داخل متن پست (اگر باشد). */
export function firstUrl(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[).,،؛]+$/, '') : '';
}

/**
 * HTML صفحهٔ پیش‌نمایش کانال را به فهرست پست‌ها تبدیل می‌کند.
 * خروجی از قدیم به جدید مرتب است و تکراری‌ها حذف می‌شوند.
 */
export function parseTelegramHtml(html, { limit = 20 } = {}) {
  const source = String(html ?? '');
  const blocks = source.split('data-post="').slice(1);
  const posts = [];
  const seen = new Set();

  for (const chunk of blocks) {
    const idEnd = chunk.indexOf('"');
    if (idEnd === -1) continue;
    const postId = chunk.slice(0, idEnd);
    if (!/^[\w-]+\/\d+$/.test(postId) || seen.has(postId)) continue;
    const block = chunk.slice(idEnd);

    const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = telegramHtmlToText(textMatch ? textMatch[1] : '');
    const media = detectMedia(block);
    if (!text && !media) continue; // پست‌های سرویس/خالی نمایش داده نمی‌شوند

    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    const published = timeMatch ? new Date(timeMatch[1]).toISOString() : null;
    const viewsMatch = block.match(/class="tgme_widget_message_views">([^<]+)</);
    const forwardedMatch = block.match(/tgme_widget_message_forwarded_from_name[^>]*>([\s\S]*?)<\/a>/);

    seen.add(postId);
    posts.push({
      id: postId,
      message_id: Number(postId.split('/')[1]) || null,
      url: `https://t.me/${postId}`,
      text,
      link: firstUrl(text),
      published,
      views: viewsMatch ? decodeEntities(viewsMatch[1]).trim() : '',
      media,
      forwarded_from: forwardedMatch ? telegramHtmlToText(forwardedMatch[1]) : '',
    });
  }

  posts.sort((a, b) => {
    const left = a.published ? Date.parse(a.published) : 0;
    const right = b.published ? Date.parse(b.published) : 0;
    return left - right;
  });
  return posts.slice(-Math.max(1, Number(limit) || 20));
}

export function telegramChannelTitle(html) {
  const match = String(html ?? '').match(/<meta property="og:title" content="([^"]+)"/);
  return match ? decodeEntities(match[1]) : '';
}

/**
 * صفحهٔ پیش‌نمایش یک کانال را می‌خواند.
 * fetcher برای تست تزریق می‌شود (امضای fetch استاندارد).
 */
export async function fetchTelegramFeed(channel, { limit = 20, timeoutMs = 15000, fetcher = fetch } = {}) {
  const response = await fetcher(`https://t.me/s/${channel.handle}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes('tgme_widget_message')) throw new Error('پیش‌نمایش کانال در دسترس نیست');
  const posts = parseTelegramHtml(html, { limit }).map((post) => ({
    ...post,
    channel_id: channel.id,
    channel_name: channel.name,
    channel_handle: channel.handle,
    channel_url: `https://t.me/${channel.handle}`,
    source: telegramSource(channel),
  }));
  return {
    channel: channel.handle,
    channel_id: channel.id,
    channel_url: `https://t.me/${channel.handle}`,
    name: channel.name,
    title: telegramChannelTitle(html) || channel.name,
    fetched_at: new Date().toISOString(),
    posts,
  };
}

/** خواندن همهٔ کانال‌های فهرست به‌صورت موازی؛ خطای یک کانال بقیه را متوقف نمی‌کند. */
export async function fetchTelegramFeeds({
  channels = TELEGRAM_CHANNELS,
  limit = 20,
  timeoutMs = 15000,
  fetcher = fetch,
} = {}) {
  const settled = await Promise.allSettled(
    channels.map((channel) => fetchTelegramFeed(channel, { limit, timeoutMs, fetcher }))
  );

  const feeds = [];
  const errors = [];
  for (let index = 0; index < settled.length; index += 1) {
    const channel = channels[index];
    const result = settled[index];
    if (result.status === 'fulfilled') {
      feeds.push(result.value);
    } else {
      errors.push({
        channel_id: channel.id,
        channel: channel.handle,
        name: channel.name,
        error: String(result.reason?.message || result.reason),
      });
    }
  }

  const posts = feeds
    .flatMap((feed) => feed.posts)
    .sort((a, b) => (Date.parse(a.published) || 0) - (Date.parse(b.published) || 0));

  return {
    channels: channels.map((channel) => ({
      id: channel.id,
      handle: channel.handle,
      name: channel.name,
      url: `https://t.me/${channel.handle}`,
    })),
    feeds,
    errors,
    posts,
    fetched_at: new Date().toISOString(),
  };
}

/** سازگاری با نسخهٔ قبلی: خواندن یک کانال. */
export async function fetchTelegramPosts({ limit = 20, timeoutMs = 15000, url = TELEGRAM_PREVIEW_URL } = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes('tgme_widget_message')) throw new Error('پیش‌نمایش کانال در دسترس نیست');
  return {
    channel: TELEGRAM_CHANNEL,
    channel_url: TELEGRAM_CHANNEL_URL,
    title: telegramChannelTitle(html) || 'ایران اینترنشنال',
    fetched_at: new Date().toISOString(),
    posts: parseTelegramHtml(html, { limit }),
  };
}
