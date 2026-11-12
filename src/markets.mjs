// قیمت طلا، سکه و ارز — از خوراک عمومی TGJU (بدون کلید، بدون وابستگی)
// هر بار یک فایل JSON کوچک خوانده می‌شود و آیتم‌های انتخابی یکسان‌سازی می‌شوند.

export const MARKET_SOURCE = 'TGJU';
export const MARKET_SOURCE_URL = 'https://www.tgju.org/';

export const MARKET_FEEDS = [
  'https://call1.tgju.org/ajax.json',
  'https://call2.tgju.org/ajax.json',
];

// کلیدها همان کلیدهای خوراک TGJU هستند
export const MARKET_DEFINITIONS = [
  { id: 'dollar', key: 'price_dollar_rl', label: 'دلار آمریکا', group: 'currency', unit: 'تومان' },
  { id: 'euro', key: 'price_eur', label: 'یورو', group: 'currency', unit: 'تومان' },
  { id: 'dirham', key: 'price_aed', label: 'درهم امارات', group: 'currency', unit: 'تومان' },
  { id: 'gold18', key: 'geram18', label: 'گرم طلای ۱۸ عیار', group: 'gold', unit: 'تومان' },
  { id: 'gold24', key: 'geram24', label: 'گرم طلای ۲۴ عیار', group: 'gold', unit: 'تومان' },
  { id: 'mesghal', key: 'mesghal', label: 'مثقال طلا', group: 'gold', unit: 'تومان' },
  { id: 'coin', key: 'retail_sekee', label: 'سکه امامی', group: 'coin', unit: 'تومان' },
  { id: 'ounce', key: 'ons', label: 'انس طلای جهانی', group: 'global', unit: 'دلار' },
];

const STALE_HOURS = 48;

const toNumber = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/\s/g, '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

// زمان TGJU به وقت تهران است و ایران از ۱۴۰۱ ساعت تابستانی ندارد: +03:30 ثابت
function toIso(tehranTime) {
  if (!tehranTime) return null;
  const date = new Date(`${String(tehranTime).trim().replace(' ', 'T')}+03:30`);
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

function normalizeItem(definition, row) {
  const value = toNumber(row?.p);
  if (value === null) return null;
  const change = toNumber(row?.d) ?? 0;
  const changePercent = toNumber(row?.dp) ?? (value ? Number(((change / (value - change)) * 100).toFixed(2)) : 0);
  const updatedAt = toIso(row?.ts);
  const ageHours = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 3600000 : null;
  return {
    id: definition.id,
    label: definition.label,
    group: definition.group,
    unit: definition.unit,
    value,
    change,
    change_percent: changePercent,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    updated_at: updatedAt,
    stale: ageHours === null ? false : ageHours > STALE_HOURS,
  };
}

function summaryLine(items) {
  const pick = (id) => items.find((item) => item.id === id);
  const parts = [];
  for (const id of ['dollar', 'gold18', 'coin', 'ounce']) {
    const item = pick(id);
    if (!item) continue;
    const sign = item.change > 0 ? '+' : '';
    parts.push(`${item.label} ${item.value.toLocaleString('en-US')} ${item.unit} (${sign}${item.change_percent}٪)`);
  }
  return parts.length ? `بازار: ${parts.join(' · ')}.` : '';
}

/**
 * قیمت‌ها را از TGJU می‌خواند. اگر همهٔ میزبان‌ها پاسخ ندهند،
 * آخرین مقدارهای موفق (previous) با پرچم ok=false برگردانده می‌شوند.
 */
export async function fetchMarkets({ previous = null, timeoutMs = 20000 } = {}) {
  const fetchedAt = new Date().toISOString();
  const errors = [];

  for (const url of MARKET_FEEDS) {
    try {
      const payload = await fetchJson(url, timeoutMs);
      const current = payload && typeof payload === 'object' ? payload.current : null;
      if (!current || typeof current !== 'object') throw new Error('ساختار پاسخ نامعتبر بود');
      const items = MARKET_DEFINITIONS.map((definition) => normalizeItem(definition, current[definition.key])).filter(Boolean);
      if (!items.length) throw new Error('قیمتی در پاسخ یافت نشد');
      return {
        ok: true,
        stale: false,
        source: MARKET_SOURCE,
        source_url: MARKET_SOURCE_URL,
        feed: url,
        fetched_at: fetchedAt,
        error: '',
        items,
        summary_text: summaryLine(items),
      };
    } catch (error) {
      errors.push(`${new URL(url).host}: ${String(error?.name === 'TimeoutError' ? 'پایان زمان پاسخ' : error?.message || error)}`);
    }
  }

  const error = errors.join(' · ');
  if (previous && Array.isArray(previous.items) && previous.items.length) {
    return {
      ...previous,
      ok: false,
      stale: true,
      fetched_at: fetchedAt,
      error,
      summary_text: previous.summary_text || summaryLine(previous.items),
    };
  }

  return {
    ok: false,
    stale: true,
    source: MARKET_SOURCE,
    source_url: MARKET_SOURCE_URL,
    feed: '',
    fetched_at: fetchedAt,
    error,
    items: [],
    summary_text: '',
  };
}
