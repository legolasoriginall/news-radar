// قیمت طلا، سکه و ارز — چندمنبعی، بدون کلید و بدون وابستگی
// ترتیب منابع: TGJU (اصلی) → نرخ‌آرا (پشتیبان مستقل) و در آخر CoinGecko برای انس جهانی.
// اگر منبع اصلی مسدود شود، نرخ‌ها از منبع پشتیبان تازه می‌مانند و منشأ هر نرخ در خروجی ثبت می‌شود.

export const MARKET_SOURCE = 'TGJU';
export const MARKET_SOURCE_URL = 'https://www.tgju.org/';

export const MARKET_FEEDS = [
  'https://call1.tgju.org/ajax.json',
  'https://call2.tgju.org/ajax.json',
];

export const NERKHARA_FEED = 'https://nerkhara.com/api/v1/latest.json';
export const COINGECKO_FEED = 'https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true';

// قیمت‌های TGJU به ریال است؛ scale=0.1 آن‌ها را تومان می‌کند. نرخ‌آرا از ابتدا تومان می‌دهد.
export const MARKET_DEFINITIONS = [
  {
    id: 'dollar',
    label: 'دلار آمریکا',
    group: 'currency',
    unit: 'تومان',
    tgju: { key: 'price_dollar_rl', scale: 0.1 },
    nerkhara: { key: 'usd', scale: 1 },
  },
  {
    id: 'euro',
    label: 'یورو',
    group: 'currency',
    unit: 'تومان',
    tgju: { key: 'price_eur', scale: 0.1 },
    nerkhara: { key: 'eur', scale: 1 },
  },
  {
    id: 'dirham',
    label: 'درهم امارات',
    group: 'currency',
    unit: 'تومان',
    tgju: { key: 'price_aed', scale: 0.1 },
    nerkhara: { key: 'aed', scale: 1 },
  },
  {
    id: 'gold18',
    label: 'گرم طلای ۱۸ عیار',
    group: 'gold',
    unit: 'تومان',
    tgju: { key: 'geram18', scale: 0.1 },
    nerkhara: { key: 'gold-18k', scale: 1 },
  },
  {
    id: 'gold24',
    label: 'گرم طلای ۲۴ عیار',
    group: 'gold',
    unit: 'تومان',
    tgju: { key: 'geram24', scale: 0.1 },
    nerkhara: { key: 'gold-24k', scale: 1 },
  },
  {
    id: 'mesghal',
    label: 'مثقال طلا',
    group: 'gold',
    unit: 'تومان',
    tgju: { key: 'mesghal', scale: 0.1 },
    nerkhara: { key: 'gold-mesghal', scale: 1 },
  },
  {
    id: 'coin',
    label: 'سکه امامی',
    group: 'coin',
    unit: 'تومان',
    tgju: { key: 'retail_sekee', scale: 0.1 },
    nerkhara: { key: 'coin-emami', scale: 1 },
  },
  {
    id: 'ounce',
    label: 'انس طلای جهانی',
    group: 'global',
    unit: 'دلار',
    tgju: { key: 'ons', scale: 1 },
  },
];

const STALE_HOURS = 48;

const toNumber = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/\s/g, '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

// زمان TGJU به وقت تهران است و ایران از ۱۴۰۱ ساعت تابستانی ندارد: +03:30 ثابت
function toIsoTehran(tehranTime) {
  if (!tehranTime) return null;
  const date = new Date(`${String(tehranTime).trim().replace(' ', 'T')}+03:30`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toIsoUtc(utcTime) {
  if (!utcTime) return null;
  const date = new Date(utcTime);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsRadar/2.0; +https://github.com/legolasoriginall/news-radar)',
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function buildItem(definition, { value, change, changePercent, updatedAt }) {
  if (value === null) return null;
  const roundedValue = Math.round(value * 100) / 100;
  const percentInput = changePercent === null || changePercent === undefined ? null : Number(changePercent);
  // بعضی منابع فقط درصد تغییر می‌دهند؛ مقدار تغییر از آن ساخته می‌شود
  let roundedChange;
  if (change === null || change === undefined) {
    roundedChange = percentInput === null || !Number.isFinite(percentInput)
      ? 0
      : Math.round((roundedValue - roundedValue / (1 + percentInput / 100)) * 100) / 100;
  } else {
    roundedChange = Math.round(Number(change) * 100) / 100;
  }
  const percent = percentInput === null || !Number.isFinite(percentInput)
    ? (roundedValue ? Number(((roundedChange / (roundedValue - roundedChange || 1)) * 100).toFixed(2)) : 0)
    : Math.round(percentInput * 100) / 100;
  const ageHours = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 3600000 : null;
  return {
    id: definition.id,
    label: definition.label,
    group: definition.group,
    unit: definition.unit,
    value: roundedValue,
    change: roundedChange,
    change_percent: percent,
    direction: roundedChange > 0 ? 'up' : roundedChange < 0 ? 'down' : 'flat',
    updated_at: updatedAt,
    stale: ageHours === null ? false : ageHours > STALE_HOURS,
  };
}

/* ── منبع اصلی: TGJU ─────────────────────────────────────────── */
export async function loadTgju({ timeoutMs = 20000 } = {}) {
  const errors = [];
  for (const url of MARKET_FEEDS) {
    try {
      const payload = await fetchJson(url, timeoutMs);
      const current = payload && typeof payload === 'object' ? payload.current : null;
      if (!current || typeof current !== 'object') throw new Error('ساختار پاسخ نامعتبر بود');
      const items = [];
      for (const definition of MARKET_DEFINITIONS) {
        const mapping = definition.tgju;
        if (!mapping) continue;
        const row = current[mapping.key];
        const raw = toNumber(row?.p);
        if (raw === null) continue;
        const item = buildItem(definition, {
          value: raw * mapping.scale,
          change: (toNumber(row?.d) ?? 0) * mapping.scale,
          changePercent: toNumber(row?.dp),
          updatedAt: toIsoTehran(row?.ts),
        });
        if (item) items.push(item);
      }
      if (!items.length) throw new Error('قیمتی در پاسخ یافت نشد');
      return { items, feed: url };
    } catch (error) {
      errors.push(`${new URL(url).host}: ${String(error?.name === 'TimeoutError' ? 'پایان زمان پاسخ' : error?.message || error)}`);
    }
  }
  throw new Error(errors.join(' · ') || 'دریافت TGJU ناموفق بود');
}

/* ── منبع پشتیبان: نرخ‌آرا (مستقل از TGJU) ───────────────────── */
export async function loadNerkhara({ timeoutMs = 20000 } = {}) {
  const payload = await fetchJson(NERKHARA_FEED, timeoutMs);
  const list = Array.isArray(payload?.items) ? payload.items : [];
  if (!list.length) throw new Error('فهرست نرخ‌ها خالی بود');
  const byId = new Map(list.map((entry) => [String(entry?.id || ''), entry]));
  const items = [];
  for (const definition of MARKET_DEFINITIONS) {
    const mapping = definition.nerkhara;
    if (!mapping) continue;
    const row = byId.get(mapping.key);
    const raw = toNumber(row?.price);
    if (raw === null) continue;
    const item = buildItem(definition, {
      value: raw * mapping.scale,
      change: null,
      changePercent: toNumber(row?.change_pct),
      updatedAt: toIsoUtc(row?.updated_utc),
    });
    if (item) items.push(item);
  }
  if (!items.length) throw new Error('نرخی برای موارد موردنظر یافت نشد');
  return { items, feed: NERKHARA_FEED };
}

/* ── پشتیبان انس جهانی ───────────────────────────────────────── */
export async function loadGlobalOunce({ timeoutMs = 15000 } = {}) {
  const payload = await fetchJson(COINGECKO_FEED, timeoutMs);
  const price = toNumber(payload?.['tether-gold']?.usd);
  if (price === null) throw new Error('نرخ انس در پاسخ نبود');
  const definition = MARKET_DEFINITIONS.find((item) => item.id === 'ounce');
  const item = buildItem(definition, {
    value: price,
    change: null,
    changePercent: toNumber(payload?.['tether-gold']?.usd_24h_change),
    updatedAt: new Date().toISOString(),
  });
  if (!item) throw new Error('نرخ انس نامعتبر بود');
  return { items: [item], feed: COINGECKO_FEED };
}

/* ── تاریخچهٔ قیمت برای نمودار روند ───────────────────────────── */
export const HISTORY_SERIES = ['dollar', 'gold18', 'coin', 'ounce'];
export const HISTORY_MAX_POINTS = 720;

// فقط برای پر کردن اولیهٔ نمودار استفاده می‌شود (نقاط روزانه، به تومان)
const HISTORY_SEED_FEEDS = {
  dollar: 'https://nerkhara.com/api/v1/history/usd.json',
  gold18: 'https://nerkhara.com/api/v1/history/gold-18k.json',
};

export async function loadHistorySeed({ days = 60, timeoutMs = 20000 } = {}) {
  const points = new Map();
  for (const [id, url] of Object.entries(HISTORY_SEED_FEEDS)) {
    try {
      const payload = await fetchJson(url, timeoutMs);
      const list = Array.isArray(payload?.points) ? payload.points.slice(-days) : [];
      for (const entry of list) {
        const [day, price] = entry || [];
        const value = toNumber(price);
        if (!day || value === null) continue;
        const at = `${day}T12:00:00.000Z`;
        const existing = points.get(at) || { at, prices: {} };
        existing.prices[id] = Math.round(value);
        points.set(at, existing);
      }
    } catch {
      // پر کردن اولیه اختیاری است؛ خطای آن مانع کار نیست
    }
  }
  return [...points.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export function appendHistoryPoint(history, markets, { maxPoints = HISTORY_MAX_POINTS, minGapMs = 4 * 60 * 1000 } = {}) {
  const list = Array.isArray(history)
    ? history.filter((point) => point && point.at && point.prices).map((point) => ({ at: point.at, prices: { ...point.prices } }))
    : [];
  const prices = {};
  for (const item of markets?.items || []) {
    if (HISTORY_SERIES.includes(item.id)) prices[item.id] = Math.round(item.value * 100) / 100;
  }
  if (!Object.keys(prices).length) return list.slice(-maxPoints);
  const at = markets.fetched_at || new Date().toISOString();
  const last = list[list.length - 1];
  if (last && Math.abs(new Date(at).getTime() - new Date(last.at).getTime()) < minGapMs) {
    list[list.length - 1] = { at, prices: { ...last.prices, ...prices } };
  } else {
    list.push({ at, prices });
  }
  return list.slice(-maxPoints);
}

/**
 * تاریخچهٔ نمودار را می‌سازد: اگر نمونه‌ای وجود نداشته باشد، ابتدا
 * از آرشیو روزانهٔ نرخ‌آرا پر می‌شود و سپس نقطهٔ فعلی اضافه می‌شود.
 */
export async function buildMarketHistory({ previousHistory = null, markets } = {}) {
  let history = Array.isArray(previousHistory) ? previousHistory : [];
  if (history.length < 10) {
    const seed = await loadHistorySeed();
    if (seed.length) {
      const byTime = new Map(seed.map((point) => [point.at, point]));
      for (const point of history) byTime.set(point.at, point);
      history = [...byTime.values()].sort((a, b) => a.at.localeCompare(b.at));
    }
  }
  return appendHistoryPoint(history, markets);
}

export const MARKET_PROVIDERS = [
  { id: 'tgju', label: 'TGJU', load: loadTgju },
  { id: 'nerkhara', label: 'نرخ‌آرا', load: loadNerkhara },
];

export const GLOBAL_PROVIDERS = [{ id: 'coingecko', label: 'CoinGecko', load: loadGlobalOunce }];

function summaryLine(items) {
  const pick = (id) => items.find((item) => item.id === id);
  const parts = [];
  for (const id of ['dollar', 'gold18', 'coin', 'ounce']) {
    const item = pick(id);
    if (!item) continue;
    const sign = item.change_percent > 0 ? '+' : '';
    parts.push(`${item.label} ${Math.round(item.value).toLocaleString('en-US')} ${item.unit} (${sign}${item.change_percent}٪)`);
  }
  return parts.length ? `بازار: ${parts.join(' · ')}.` : '';
}

async function tryProvider(provider, timeoutMs) {
  try {
    const { items, feed } = await provider.load({ timeoutMs });
    return { id: provider.id, label: provider.label, ok: true, error: '', feed, items, used: false };
  } catch (error) {
    return {
      id: provider.id,
      label: provider.label,
      ok: false,
      error: String(error?.name === 'TimeoutError' ? 'پایان زمان پاسخ' : error?.message || error),
      feed: '',
      items: [],
      used: false,
    };
  }
}

/**
 * نرخ‌ها را از نخستین منبعی که پاسخ دهد برمی‌دارد و برای مواردی که منبع اصلی ندارد
 * (مثل انس جهانی) از منبع بعدی تکمیل می‌کند. اگر هیچ منبعی پاسخ ندهد،
 * آخرین مقدار موفق (previous) با پرچم ok=false برگردانده می‌شود.
 */
export async function fetchMarkets({ previous = null, timeoutMs = 20000 } = {}) {
  const fetchedAt = new Date().toISOString();
  const attempts = [];

  for (const provider of MARKET_PROVIDERS) {
    const attempt = await tryProvider(provider, timeoutMs);
    attempts.push(attempt);
    // پشتیبان‌ها فقط وقتی صدا زده می‌شوند که منبع اصلی ناقص باشد
    if (attempt.ok && attempt.items.length >= MARKET_DEFINITIONS.length) break;
    if (attempt.ok) break;
  }

  const byId = new Map();
  for (const attempt of attempts) {
    if (!attempt.ok) continue;
    for (const item of attempt.items) {
      if (byId.has(item.id)) continue;
      byId.set(item.id, { ...item, source: attempt.label });
      attempt.used = true;
    }
  }

  // تکمیل موارد باقی‌مانده از منابع جهانی (انس طلا)
  const missing = MARKET_DEFINITIONS.filter((definition) => !byId.has(definition.id));
  if (missing.length) {
    for (const provider of GLOBAL_PROVIDERS) {
      const attempt = await tryProvider(provider, Math.min(timeoutMs, 15000));
      attempts.push(attempt);
      if (!attempt.ok) continue;
      for (const item of attempt.items) {
        if (byId.has(item.id)) continue;
        byId.set(item.id, { ...item, source: attempt.label });
      }
      if (MARKET_DEFINITIONS.every((definition) => byId.has(definition.id))) break;
    }
  }

  const items = MARKET_DEFINITIONS.map((definition) => byId.get(definition.id)).filter(Boolean);
  const usedLabels = [...new Set(items.map((item) => item.source).filter(Boolean))];
  const errors = attempts.filter((attempt) => !attempt.ok).map((attempt) => `${attempt.label}: ${attempt.error}`);

  if (!items.length) {
    if (previous && Array.isArray(previous.items) && previous.items.length) {
      return {
        ...previous,
        ok: false,
        stale: true,
        fetched_at: fetchedAt,
        error: errors.join(' · '),
        summary_text: previous.summary_text || summaryLine(previous.items),
      };
    }
    return {
      ok: false,
      stale: true,
      partial: false,
      source: MARKET_SOURCE,
      source_url: MARKET_SOURCE_URL,
      feed: '',
      fetched_at: fetchedAt,
      error: errors.join(' · '),
      items: [],
      providers: attempts.map(({ id, label, ok, error }) => ({ id, label, ok, error })),
      summary_text: '',
    };
  }

  return {
    ok: true,
    stale: false,
    partial: items.length < MARKET_DEFINITIONS.length,
    source: usedLabels.join(' + ') || MARKET_SOURCE,
    source_url: MARKET_SOURCE_URL,
    feed: attempts.find((attempt) => attempt.used)?.feed || '',
    fetched_at: fetchedAt,
    error: errors.join(' · '),
    items,
    providers: attempts.map(({ id, label, ok, error, feed, used }) => ({ id, label, ok, error, feed, used })),
    summary_text: summaryLine(items),
  };
}
