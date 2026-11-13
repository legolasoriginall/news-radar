// هشدارهای خودکار: منبع خبری خراب یا قطع شدن پخش زنده
// هر وضعیت خراب یک‌بار هشدار می‌دهد، تکرارش با فاصلهٔ cooldown دوباره اعلام می‌شود و
// وقتی مشکل برطرف شد یک پیام «بازگشت به حالت عادی» ثبت می‌شود.

export const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
// سکوت خبری را دیرتر تکرار می‌کند تا فهرست منابع، تلگرام را پر نکند.
export const SILENCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const ALERT_LIMIT = 100;
export const SILENT_HOURS = 24;

export function telegramConfig(env = process.env) {
  const token = String(env.ALERT_TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(env.ALERT_TELEGRAM_CHAT_ID || '').trim();
  return { token, chatId, configured: Boolean(token && chatId) };
}

export function maskChatId(chatId) {
  const value = String(chatId || '');
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}•••${value.slice(-2)}`;
}

/** تازه‌ترین زمان انتشار هر منبع را از خبرها حساب می‌کند. */
export function latestBySource(articles = []) {
  const map = new Map();
  for (const article of Array.isArray(articles) ? articles : []) {
    const id = article?.source_id;
    const timestamp = Date.parse(article?.published || '');
    if (!id || !Number.isFinite(timestamp)) continue;
    if (!map.has(id) || timestamp > map.get(id)) map.set(id, timestamp);
  }
  return map;
}

function faNumber(value) {
  return Number(value || 0).toLocaleString('fa-IR');
}

/** از دادهٔ سایت و نتیجهٔ بررسی پخش، فهرست مشکلات فعلی را می‌سازد. */
export function collectIssues({ data, channels = [], now = Date.now(), silentHours = SILENT_HOURS } = {}) {
  const issues = [];
  const latest = latestBySource(data?.articles);
  for (const source of Array.isArray(data?.source_health) ? data.source_health : []) {
    const name = source.name || source.id || 'منبع ناشناخته';
    if (!source.ok) {
      issues.push({
        id: `source:${source.id || name}`,
        kind: 'source',
        target: name,
        message: `منبع «${name}» خطا داد: ${source.error || source.status || 'بی‌پاسخ'}`,
      });
      continue;
    }
    // منبع سالم است؛ اگر منبعی که قبلاً خبر می‌داد حالا مدت‌ها خاموش مانده، سکوت خبری است.
    // منابعی که هیچ خبری با تاریخ معتبر ندارند (معمولاً ردشده در فیلترها) هشدار نمی‌دهند تا هشدار تکراری نسازند.
    const lastTs = latest.get(source.id);
    if (!lastTs) continue;
    const ageHours = (now - lastTs) / 3600000;
    if (ageHours <= silentHours) continue;
    const ageText = ageHours >= 48
      ? `حدود ${faNumber(Math.floor(ageHours / 24))} روز`
      : `حدود ${faNumber(Math.floor(ageHours))} ساعت`;
    issues.push({
      id: `silence:${source.id || name}`,
      kind: 'silence',
      target: name,
      message: `منبع «${name}» ${ageText} است خبر تازه‌ای نداده.`,
    });
  }
  for (const channel of channels) {
    if (!channel || channel.healthy) continue;
    const name = channel.name || channel.id || 'شبکه ناشناخته';
    issues.push({
      id: `stream:${channel.id || name}`,
      kind: 'stream',
      target: name,
      message: `هیچ مسیر پخشی برای «${name}» پاسخ نداد.`,
    });
  }
  return issues;
}

/**
 * هشدارهای تازه را می‌سازد و وضعیت را برمی‌گرداند.
 * state: { alerts: [], open: { [id]: { target, kind, since, last_sent_at } } }
 */
export function applyIssues({
  state = {},
  issues = [],
  now = Date.now(),
  cooldownMs = { source: ALERT_COOLDOWN_MS, stream: ALERT_COOLDOWN_MS, silence: SILENCE_COOLDOWN_MS },
  limit = ALERT_LIMIT,
} = {}) {
  const cooldownFor = (kind) => {
    if (typeof cooldownMs === 'number') return cooldownMs;
    return Number(cooldownMs?.[kind] ?? ALERT_COOLDOWN_MS);
  };
  const open = {};
  for (const [id, value] of Object.entries(state.open || {})) open[id] = { ...value };
  let alerts = Array.isArray(state.alerts) ? state.alerts.slice() : [];
  const created = [];
  const active = new Set(issues.map((issue) => issue.id));
  const at = new Date(now).toISOString();

  for (const issue of issues) {
    const previous = open[issue.id];
    const due = previous ? now - new Date(previous.last_sent_at || 0).getTime() >= cooldownFor(issue.kind) : true;
    if (!previous) {
      open[issue.id] = { target: issue.target, kind: issue.kind, since: at, last_sent_at: at };
    } else if (due) {
      previous.last_sent_at = at;
    } else {
      continue;
    }
    const alert = { id: issue.id, kind: issue.kind, target: issue.target, message: issue.message, at, recovery: false, read: false };
    alerts = [alert, ...alerts];
    created.push(alert);
  }

  for (const [id, previous] of Object.entries(open)) {
    if (active.has(id)) continue;
    delete open[id];
    const alert = {
      id,
      kind: previous.kind || 'source',
      target: previous.target || '',
      message: `وضعیت «${previous.target || id}» به حالت عادی برگشت.`,
      at,
      recovery: true,
      read: false,
    };
    alerts = [alert, ...alerts];
    created.push(alert);
  }

  return { state: { alerts: alerts.slice(0, limit), open }, created };
}

export function unreadCount(state = {}) {
  return (Array.isArray(state.alerts) ? state.alerts : []).filter((alert) => !alert.read).length;
}

export function markAllRead(state = {}, now = Date.now()) {
  const at = new Date(now).toISOString();
  return {
    ...state,
    alerts: (Array.isArray(state.alerts) ? state.alerts : []).map((alert) => (alert.read ? alert : { ...alert, read: true, read_at: at })),
  };
}

/** متن فارسی هشدار برای پنل و تلگرام. */
export function formatAlert(alert, { siteUrl = '' } = {}) {
  const when = alert?.at ? new Date(alert.at).toLocaleString('fa-IR') : '';
  const head = alert.recovery
    ? `✅ بازگشت به حالت عادی${alert.kind === 'stream' ? ' (پخش زنده)' : ''}`
    : alert.kind === 'stream'
      ? '📺 پخش زنده قطع شده'
      : alert.kind === 'silence'
        ? '😴 سکوت خبری'
        : '⚠️ منبع خبری خراب';
  const lines = [head, alert.message || '', when ? `زمان: ${when}` : '', siteUrl ? siteUrl : ''];
  return lines.filter(Boolean).join('\n');
}

/** ارسال پیام به بات تلگرام؛ بدون توکن/چت‌آیدی چیزی رد نمی‌شود. */
export async function sendTelegram({ token, chatId, text, fetcher = fetch, timeoutMs = 10000, apiBase = 'https://api.telegram.org' } = {}) {
  if (!token || !chatId) return { ok: false, skipped: true, error: 'بات تلگرام تنظیم نشده است' };
  try {
    const response = await fetcher(`${String(apiBase).replace(/\/+$/, '')}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text || '').slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      return { ok: false, error: payload.description || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}
