// دسترسی دستیار مدیر به اینترنت، بدون کلید API
// جستجوی وب از خوراک عمومی گوگل‌نیوز (فارسی/انگلیسی) خوانده می‌شود و خواندن صفحه با
// تبدیل HTML به متن ساده انجام می‌شود. آدرس‌های داخلی/خصوصی مسدودند تا سرور به سرویس‌های
// داخلی خودش دسترسی پیدا نکند.

import { decodeEntities, stripHtml, cleanText } from './parse.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** آیا آدرس عمومی است (نه localhost و نه شبکهٔ خصوصی). */
export function isPublicUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (host === '::1' || host === '[::1]') return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
  return true;
}

function pick(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? cleanText(stripHtml(decodeEntities(match[1]))) : '';
}

/** خوراک جستجوی گوگل‌نیوز را به فهرست نتیجه تبدیل می‌کند. */
export function parseNewsSearch(xml, { limit = 5 } = {}) {
  const items = [];
  const blocks = String(xml || '').match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const raw of blocks) {
    const block = raw.replace(/^<item>/i, '').replace(/<\/item>$/i, '');
    const title = pick(block, 'title');
    const link = pick(block, 'link') || pick(block, 'guid');
    if (!title || !link) continue;
    const published = pick(block, 'pubDate');
    const source = pick(block, 'source');
    items.push({ title, link, published: published ? new Date(published).toISOString() : null, source });
    if (items.length >= Math.max(1, Number(limit) || 5)) break;
  }
  return items;
}

/** جستجوی وب در خبرها؛ بدون کلید و بدون ثبت‌نام. */
export async function searchWeb({ query, limit = 5, lang = 'fa', fetcher = fetch, timeoutMs = 12000 } = {}) {
  const text = String(query || '').trim();
  if (!text) return { ok: false, error: 'عبارت جستجو خالی است' };
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 8);
  const locale = lang === 'en'
    ? 'hl=en-US&gl=US&ceid=US:en'
    : 'hl=fa&gl=IR&ceid=IR:fa';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(text)}&${locale}`;
  try {
    const response = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, error: `جستجو پاسخ نداد (HTTP ${response.status})` };
    const xml = await response.text();
    const items = parseNewsSearch(xml, { limit: safeLimit });
    if (!items.length) return { ok: false, error: 'نتیجه‌ای برای این عبارت پیدا نشد' };
    return { ok: true, query: text, provider: 'google-news', items };
  } catch (error) {
    return { ok: false, error: `جستجو ممکن نشد: ${String(error?.message || error)}` };
  }
}

/** HTML را به متن خوانا تبدیل می‌کند (اسکریپت/استایل حذف می‌شوند). */
export function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pageTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(stripHtml(decodeEntities(match[1]))) : '';
}

/** یک صفحهٔ اینترنتی را می‌خواند و متن اصلی‌اش را برمی‌گرداند. */
export async function readPage({ url, fetcher = fetch, timeoutMs = 15000, maxChars = 4000 } = {}) {
  const target = String(url || '').trim();
  if (!isPublicUrl(target)) {
    return { ok: false, error: 'فقط آدرس‌های عمومی http/https قابل خواندن هستند' };
  }
  try {
    const response = await fetcher(target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, error: `صفحه پاسخ نداد (HTTP ${response.status})` };
    // تغییرمسیر هم باید به آدرس عمومی بماند؛ وگرنه یک نشانی عمومی می‌تواند
    // درخواست را به سرویس داخلی همین سرور هدایت کند.
    const finalUrl = String(response.url || target);
    if (!isPublicUrl(finalUrl)) {
      return { ok: false, error: 'تغییرمسیر به آدرس غیرعمومی مسدود شد' };
    }
    const type = String(response.headers?.get?.('content-type') || '');
    const body = await response.text();
    if (type && !/text\/|xml|json/i.test(type)) {
      return { ok: false, error: `نوع محتوا پشتیبانی نمی‌شود (${type})` };
    }
    const text = /html/i.test(type) || /<html|<body/i.test(body.slice(0, 500)) ? htmlToText(body) : body.trim();
    const limit = Math.min(Math.max(Number(maxChars) || 4000, 500), 8000);
    return {
      ok: true,
      url: target,
      title: pageTitle(body) || '',
      text: text.slice(0, limit),
      truncated: text.length > limit,
    };
  } catch (error) {
    return { ok: false, error: `خواندن صفحه ممکن نشد: ${String(error?.message || error)}` };
  }
}

/** نخستین لینک داخل متن مدیر (برای دستور «این لینک را بخوان»). */
export function firstUrlIn(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"'”«»]+/i);
  return match ? match[0].replace(/[).,،؛!؟]+$/, '') : '';
}
