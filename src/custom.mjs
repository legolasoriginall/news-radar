// افزودن منبع خبری و کانال تلگرام از داخل پنل مدیر
// ورودی‌های کاربر اینجا پاک‌سازی و اعتبارسنجی می‌شوند تا فهرست منابع خراب نشود.

const SOURCE_LANGS = new Set(['fa', 'en']);
const ORIGINS = new Set(['iran', 'foreign']);

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function fail(error) {
  return { ok: false, error };
}

/** ورودی فرم «منبع خبری» را به رکوردی سازگار با فهرست منابع تبدیل می‌کند. */
export function parseSourceInput({ name, url, lang, origin, weight } = {}) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return fail('آدرس فید را بگذار');
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return fail('آدرس فید معتبر نیست');
  }
  if (!/^https?:$/.test(parsed.protocol)) return fail('آدرس فید باید http یا https باشد');

  const cleanName = String(name || '').trim().slice(0, 60) || parsed.hostname.replace(/^www\./, '');
  const cleanLang = SOURCE_LANGS.has(String(lang || '').toLowerCase()) ? String(lang).toLowerCase() : 'fa';
  const cleanOrigin = ORIGINS.has(String(origin || '').toLowerCase()) ? String(origin).toLowerCase() : 'foreign';
  const numericWeight = Number(weight);
  const cleanWeight = Number.isFinite(numericWeight) ? Math.min(Math.max(numericWeight, 0.5), 0.9) : 0.7;

  return {
    ok: true,
    source: {
      id: `custom_${slug(parsed.hostname) || 'feed'}`,
      name: cleanName,
      url: parsed.toString(),
      lang: cleanLang,
      weight: Number(cleanWeight.toFixed(2)),
      origin: cleanOrigin,
      custom: true,
    },
  };
}

/** شناسهٔ کانال را از @name یا لینک t.me بیرون می‌کشد. */
export function parseChannelHandle(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\//i, '')
    .replace(/^s\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .trim();
}

/** ورودی فرم «کانال تلگرام» را به رکورد کانال تبدیل می‌کند. */
export function parseChannelInput({ handle, name, weight } = {}) {
  const cleanHandle = parseChannelHandle(handle);
  if (!cleanHandle) return fail('نام کانال یا لینک t.me را بگذار');
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(cleanHandle)) {
    return fail('نام کانال باید با حرف شروع شود و ۴ تا ۳۲ نویسهٔ انگلیسی/عدد/ـ داشته باشد');
  }
  const cleanName = String(name || '').trim().slice(0, 60) || `@${cleanHandle}`;
  const numericWeight = Number(weight);
  const cleanWeight = Number.isFinite(numericWeight) ? Math.min(Math.max(numericWeight, 0.5), 0.9) : 0.7;
  return {
    ok: true,
    channel: {
      id: `custom_tg_${cleanHandle.toLowerCase()}`,
      handle: cleanHandle,
      name: cleanName,
      label: `${cleanName} (تلگرام)`,
      weight: Number(cleanWeight.toFixed(2)),
      custom: true,
    },
  };
}

/** آیا پاسخ یک نشانی، خوراک RSS/Atom/RDF است. */
export function looksLikeFeed(text) {
  const value = String(text || '').slice(0, 4000);
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(value);
}

/** شمارش تقریبی آیتم‌های خوراک برای تأیید اینکه خالی نیست. */
export function feedItemCount(text) {
  const value = String(text || '');
  const items = value.match(/<item[\s>]/gi);
  const entries = value.match(/<entry[\s>]/gi);
  return (items ? items.length : 0) + (entries ? entries.length : 0);
}
