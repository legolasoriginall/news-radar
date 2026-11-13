// سرور داشبورد + به‌روزرسانی خودکار هر ۵ دقیقه
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { runPipeline } from './pipeline.mjs';
import { fetchMarkets } from './src/markets.mjs';
import { fetchTelegramFeeds, fetchTelegramFeed, addTelegramChannel, removeTelegramChannel, TELEGRAM_CHANNELS } from './src/telegram.mjs';
import { parseSourceInput, parseChannelInput, looksLikeFeed, feedItemCount } from './src/custom.mjs';
import { resolveLiveChannels, probeStream, LIVE_CHANNELS } from './src/live.mjs';
import {
  collectIssues,
  applyIssues,
  markAllRead,
  unreadCount,
  formatAlert,
  sendTelegram,
  telegramConfig,
  maskChatId,
} from './src/alerts.mjs';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  verifySession,
  parseCookies,
  passwordMatches,
  hashPassword,
  verifyPassword,
  validateNewPassword,
  llmConfig,
  detectOllama,
  intentOf,
  queryOf,
  describeToolResult,
  runTool,
  runAssistant,
} from './src/admin.mjs';

// متغیرهای محلی (رمز مدیر، کلید مدل) از .env خوانده می‌شوند؛ این فایل در گیت نیست.
try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
} catch {
  /* بدون .env هم سرور بالا می‌آید */
}
import { SOURCES, addSource, removeSource, UPDATE_INTERVAL_MINUTES } from './src/sources.mjs';

// نرخ‌های بازار جدا از خبرها و هر چند ثانیه یک‌بار خوانده می‌شوند تا تابلوی قیمت «لحظه‌ای» باشد.
const LIVE_MARKETS_TTL_MS = Number(process.env.MARKETS_TTL_SECONDS || 20) * 1000;
const liveMarkets = { at: 0, payload: null, inflight: null };

// پست‌های کانال تلگرام ایران اینترنشنال هر چند ثانیه خوانده می‌شوند تا همان لحظهٔ انتشار دیده شوند.
const LIVE_TELEGRAM_TTL_MS = Number(process.env.TELEGRAM_TTL_SECONDS || 15) * 1000;
const liveTelegram = { at: 0, payload: null, inflight: null };

// مسیرهای پخش زنده از فهرست‌های عمومی جمع می‌شوند و هر چند دقیقه یک‌بار تازه می‌شوند.
const LIVE_CHANNELS_TTL_MS = Number(process.env.LIVE_CHANNELS_TTL_SECONDS || 600) * 1000;
const liveChannelCache = { at: 0, payload: null, inflight: null };

// دستیار مدیر فقط روی سرور خود میزبان فعال است؛ رمز و کلید مدل از محیط خوانده می‌شوند.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const loginAttempts = new Map();

// رمز مدیر در فایل محلی به‌صورت هش نگه داشته می‌شود تا از پنل قابل تغییر باشد.
const AUTH_FILE = path.join(path.resolve('.'), '.admin-auth.json');
const authState = { record: null, secret: '' };

async function saveAuthRecord(record) {
  await writeFile(AUTH_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
  authState.record = record;
  authState.secret = record.secret;
}

async function loadAuthRecord() {
  try {
    const record = JSON.parse(await readFile(AUTH_FILE, 'utf8'));
    if (record && record.salt && record.hash) {
      authState.record = record;
      authState.secret = record.secret || record.hash;
      return;
    }
  } catch {
    /* نخستین اجرا */
  }
  if (ADMIN_PASSWORD) {
    await saveAuthRecord({
      ...hashPassword(ADMIN_PASSWORD),
      secret: randomBytes(32).toString('hex'),
      updated_at: new Date().toISOString(),
    });
  }
}

const ROOT = path.resolve('.');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const INTERVAL_MS = UPDATE_INTERVAL_MINUTES * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const state = {
  running: false,
  last_error: '',
  last_started_at: '',
  last_finished_at: '',
  next_run_at: '',
  clients: new Set(),
};

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of state.clients) {
    try {
      res.write(message);
    } catch {
      state.clients.delete(res);
    }
  }
}

async function readData() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, 'data.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function refresh() {
  if (state.running) return { ok: false, running: true, message: 'به‌روزرسانی در حال اجراست' };
  state.running = true;
  state.last_started_at = new Date().toISOString();
  broadcast('status', { running: true, started_at: state.last_started_at });
  try {
    const data = await runPipeline({ quiet: true });
    state.last_error = '';
    state.last_finished_at = new Date().toISOString();
    state.next_run_at = new Date(Date.now() + INTERVAL_MS).toISOString();
    broadcast('update', { generated_at: data.generated_at, total: data.stats.total });
    // منابع خبری تازه بررسی شده‌اند؛ همان لحظه هشدار منبع خراب را به‌روز کن.
    checkAlerts({ probeStreams: false }).catch(() => {});
    return { ok: true, generated_at: data.generated_at, total: data.stats.total };
  } catch (error) {
    state.last_error = String(error?.message || error);
    state.next_run_at = new Date(Date.now() + INTERVAL_MS).toISOString();
    console.error('✖ خطا در به‌روزرسانی خودکار:', error);
    broadcast('error', { message: state.last_error });
    return { ok: false, error: state.last_error };
  } finally {
    state.running = false;
    broadcast('status', { running: false, last_error: state.last_error });
  }
}

async function scheduleRefresh() {
  const data = await readData();
  const lastTs = data ? new Date(data.generated_at).getTime() : 0;
  const age = Date.now() - lastTs;
  if (!data || !Number.isFinite(age) || age > INTERVAL_MS) {
    console.log('› داده تازه نیست؛ اجرای نخستین به‌روزرسانی…');
    await refresh();
  } else {
    state.next_run_at = new Date(lastTs + INTERVAL_MS).toISOString();
  }
  setTimeout(function tick() {
    const startedAt = Date.now();
    refresh().finally(() => {
      const elapsed = Date.now() - startedAt;
      setTimeout(tick, Math.max(5000, INTERVAL_MS - elapsed));
    });
  }, Math.max(5000, new Date(state.next_run_at).getTime() - Date.now()));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function getLiveMarkets() {
  if (liveMarkets.payload && Date.now() - liveMarkets.at < LIVE_MARKETS_TTL_MS) return liveMarkets.payload;
  if (liveMarkets.inflight) return liveMarkets.inflight;
  liveMarkets.inflight = (async () => {
    try {
      const data = await readData();
      const result = await fetchMarkets({ previous: data?.markets || null });
      const payload = {
        ok: Boolean(result.ok),
        stale: Boolean(result.stale),
        source: result.source || '',
        items: result.items || [],
        warnings: result.warnings || [],
        providers: result.providers || [],
        divergence_threshold_percent: result.divergence_threshold_percent,
        error: result.error || '',
        fetched_at: new Date().toISOString(),
        ttl_seconds: Math.round(LIVE_MARKETS_TTL_MS / 1000),
      };
      if (payload.items.length) {
        liveMarkets.payload = payload;
        liveMarkets.at = Date.now();
      }
      return payload;
    } catch (error) {
      return {
        ok: false,
        stale: true,
        source: '',
        items: liveMarkets.payload?.items || [],
        warnings: [],
        error: String(error?.message || error),
        fetched_at: new Date().toISOString(),
      };
    } finally {
      liveMarkets.inflight = null;
    }
  })();
  return liveMarkets.inflight;
}

async function getLiveTelegram() {
  if (liveTelegram.payload && Date.now() - liveTelegram.at < LIVE_TELEGRAM_TTL_MS) return liveTelegram.payload;
  if (liveTelegram.inflight) return liveTelegram.inflight;
  liveTelegram.inflight = (async () => {
    try {
      const payload = await fetchTelegramFeeds({ limit: 20 });
      if (payload.posts.length) {
        liveTelegram.payload = payload;
        liveTelegram.at = Date.now();
      }
      return payload;
    } catch (error) {
      const data = await readData();
      return {
        channels: liveTelegram.payload?.channels || data?.telegram?.channels || [],
        feeds: liveTelegram.payload?.feeds || data?.telegram?.feeds || [],
        errors: [{ channel: 'all', error: String(error?.message || error) }],
        fetched_at: new Date().toISOString(),
        posts: liveTelegram.payload?.posts || data?.telegram?.posts || [],
        error: String(error?.message || error),
      };
    } finally {
      liveTelegram.inflight = null;
    }
  })();
  return liveTelegram.inflight;
}

async function getLiveChannels() {
  if (liveChannelCache.payload && Date.now() - liveChannelCache.at < LIVE_CHANNELS_TTL_MS) {
    return liveChannelCache.payload;
  }
  if (liveChannelCache.inflight) return liveChannelCache.inflight;
  liveChannelCache.inflight = (async () => {
    try {
      const payload = await resolveLiveChannels();
      liveChannelCache.payload = payload;
      liveChannelCache.at = Date.now();
      return payload;
    } catch (error) {
      return {
        channels: (liveChannelCache.payload?.channels || []).length
          ? liveChannelCache.payload.channels
          : LIVE_CHANNELS.map((channel) => ({
              id: channel.id,
              name: channel.name,
              watch: channel.watch || '',
              sources: channel.fallbacks || [],
            })),
        fetched_at: new Date().toISOString(),
        error: String(error?.message || error),
      };
    } finally {
      liveChannelCache.inflight = null;
    }
  })();
  return liveChannelCache.inflight;
}

async function readJsonBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('بدنهٔ درخواست بیش از حد بزرگ است');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function isAdmin(req) {
  if (!authState.record) return false;
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(authState.secret, cookies[SESSION_COOKIE]);
}

function sessionCookie(secret) {
  return `${SESSION_COOKIE}=${createSession(secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, since: now };
  if (now - entry.since > 5 * 60 * 1000) {
    entry.count = 0;
    entry.since = now;
  }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  return entry.count > 10;
}

async function serveAdminPage(res) {
  try {
    const body = await readFile(path.join(ROOT, 'admin.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('صفحهٔ مدیر پیدا نشد');
  }
}

async function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const filePath = path.join(ROOT, relative);
  if (!filePath.startsWith(ROOT) || relative.split('/').some((part) => part.startsWith('.'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': ext === '.json' ? 'no-store' : 'public, max-age=60',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('یافت نشد');
  }
}

// وضعیت مدل: کلید ابری، یا مدل محلی رایگان (Ollama)؛ بدون هیچ‌کدام هم «حالت بدون مدل» کار می‌کند.
let modelCache = { at: 0, info: null };

async function getModelInfo() {
  if (modelCache.info && Date.now() - modelCache.at < 30000) return modelCache.info;
  const config = llmConfig();
  let info;
  if (config.apiKey) {
    info = { provider: config.provider, model: config.model, hasKey: true, available: true, models: [] };
  } else {
    const probe = await detectOllama({ baseUrl: config.baseUrl });
    info = {
      provider: 'ollama',
      model: probe.models[0] || config.model,
      hasKey: false,
      available: probe.available,
      models: probe.models,
    };
  }
  modelCache = { at: Date.now(), info };
  return info;
}

function adminToolContext() {
  return {
    getStatus: async () => {
      const data = await readData();
      return {
        generated_at: data?.generated_at || null,
        total: data?.stats?.total || 0,
        stories: data?.stats?.stories || 0,
        multi_source: data?.stats?.multi_source_stories || 0,
        sources_ok: data?.stats?.sources_ok || 0,
        sources_total: data?.stats?.sources_total || 0,
        fresh_24h: data?.stats?.fresh_24h || 0,
        telegram_posts: data?.stats?.telegram_posts || 0,
        markets: Array.isArray(data?.markets?.items) ? data.markets.items.length : 0,
        last_error: state.last_error || '',
        next_run_at: state.next_run_at || null,
      };
    },
    getData: async () => readData(),
    refresh: async () => refresh(),
  };
}

// هشدارها: منبع خراب و پخش قطع‌شده، در فایل محلی نگه داشته می‌شوند و در صورت تنظیم به تلگرام هم می‌روند.
const ALERTS_FILE = path.join(path.resolve('.'), '.alerts.json');
const alertState = { data: { alerts: [], open: {} }, running: false, last_check_at: '' };

async function loadAlertState() {
  try {
    const saved = JSON.parse(await readFile(ALERTS_FILE, 'utf8'));
    alertState.data = {
      alerts: Array.isArray(saved?.alerts) ? saved.alerts : [],
      open: saved?.open && typeof saved.open === 'object' ? saved.open : {},
    };
    alertState.last_check_at = saved?.last_check_at || '';
  } catch {
    /* نخستین اجرا */
  }
}

async function saveAlertState() {
  await writeFile(
    ALERTS_FILE,
    JSON.stringify({ ...alertState.data, last_check_at: alertState.last_check_at }, null, 2),
    { mode: 0o600 }
  );
}

async function probeAllChannels() {
  const results = [];
  for (const channel of LIVE_CHANNELS) {
    let healthy = '';
    for (const url of (channel.fallbacks || []).slice(0, 3)) {
      // eslint-disable-next-line no-await-in-loop
      if (await probeStream(url, { timeoutMs: 5000 })) {
        healthy = url;
        break;
      }
    }
    results.push({ id: channel.id, name: channel.name, healthy });
  }
  return results;
}

async function checkAlerts({ probeStreams = true, notify = true } = {}) {
  if (alertState.running) return { ok: false, running: true };
  alertState.running = true;
  try {
    const data = await readData();
    const channels = probeStreams ? await probeAllChannels() : [];
    const issues = collectIssues({
      data,
      channels,
      silentHours: Number(process.env.ALERT_SILENT_HOURS || 24),
    });
    const result = applyIssues({ state: alertState.data, issues });
    alertState.data = result.state;
    alertState.last_check_at = new Date().toISOString();
    await saveAlertState();

    const config = telegramConfig();
    let sent = 0;
    const errors = [];
    if (notify && config.configured) {
      for (const alert of result.created) {
        // eslint-disable-next-line no-await-in-loop
        const response = await sendTelegram({ ...config, text: formatAlert(alert) });
        if (response.ok) sent += 1;
        else errors.push(response.error);
      }
    }
    if (result.created.length) broadcast('alerts', { unread: unreadCount(alertState.data), created: result.created.length });
    return {
      ok: true,
      created: result.created.length,
      sent,
      telegram_configured: config.configured,
      errors,
      probed: channels.length,
      unread: unreadCount(alertState.data),
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    alertState.running = false;
  }
}

// منابع و کانال‌های اختصاصی که مدیر از پنل اضافه کرده است.
const CUSTOM_FILE = path.join(path.resolve('.'), '.custom-sources.json');
const customState = { sources: [], channels: [] };

async function loadCustomConfig() {
  try {
    const saved = JSON.parse(await readFile(CUSTOM_FILE, 'utf8'));
    customState.sources = Array.isArray(saved?.sources) ? saved.sources : [];
    customState.channels = Array.isArray(saved?.channels) ? saved.channels : [];
    for (const source of customState.sources) addSource({ ...source, custom: true });
    for (const channel of customState.channels) addTelegramChannel({ ...channel, custom: true });
  } catch {
    /* هنوز چیزی اضافه نشده */
  }
}

async function saveCustomConfig() {
  await writeFile(CUSTOM_FILE, JSON.stringify(customState, null, 2), { mode: 0o600 });
}

await loadAuthRecord();
await loadAlertState();
await loadCustomConfig();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/admin' || pathname === '/admin/') {
    await serveAdminPage(res);
    return;
  }

  if (pathname === '/admin/api/session') {
    const info = await getModelInfo();
    sendJson(res, 200, {
      authed: isAdmin(req),
      configured: Boolean(authState.record),
      hasKey: info.hasKey,
      model: info.model || '',
      provider: info.provider || '',
      model_available: info.available,
      local_models: info.models || [],
      mode: info.available ? (info.hasKey ? 'cloud' : 'local') : 'keyless',
      password_changed_at: authState.record?.updated_at || null,
    });
    return;
  }

  if (pathname === '/admin/api/tool' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const result = await runTool(String(body.name || ''), body.args || {}, adminToolContext());
    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/admin/api/alerts' && req.method === 'GET') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const config = telegramConfig();
    sendJson(res, 200, {
      alerts: alertState.data.alerts.slice(0, 50),
      unread: unreadCount(alertState.data),
      open: Object.keys(alertState.data.open || {}).length,
      last_check_at: alertState.last_check_at || '',
      checking: alertState.running,
      telegram: { configured: config.configured, chat_id: maskChatId(config.chatId) },
    });
    return;
  }

  if (pathname === '/admin/api/alerts/read' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    alertState.data = markAllRead(alertState.data);
    await saveAlertState();
    sendJson(res, 200, { ok: true, unread: 0 });
    return;
  }

  if (pathname === '/admin/api/alerts/check' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const result = await checkAlerts({ probeStreams: body.probe !== false });
    sendJson(res, result.ok ? 200 : 409, result);
    return;
  }

  if (pathname === '/admin/api/alerts/test' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const config = telegramConfig();
    if (!config.configured) {
      sendJson(res, 400, { error: 'ALERT_TELEGRAM_BOT_TOKEN و ALERT_TELEGRAM_CHAT_ID را در .env بگذار' });
      return;
    }
    const result = await sendTelegram({
      ...config,
      text: `🔔 پیام آزمایشی رصد خبر\nزمان: ${new Date().toLocaleString('fa-IR')}\nاتصال بات تلگرام درست است.`,
    });
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (pathname === '/admin/api/custom' && req.method === 'GET') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    sendJson(res, 200, {
      sources: customState.sources,
      channels: customState.channels,
      totals: { sources: SOURCES.length, channels: TELEGRAM_CHANNELS.length },
    });
    return;
  }

  if (pathname === '/admin/api/custom/source' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const parsed = parseSourceInput(body);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    const duplicate = SOURCES.find((source) => source.url === parsed.source.url);
    if (duplicate) {
      sendJson(res, 409, { error: `این آدرس از قبل در فهرست هست: ${duplicate.name}` });
      return;
    }
    let xml = '';
    try {
      const response = await fetch(parsed.source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewsRadar/1.0)',
          Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        sendJson(res, 400, { error: `آدرس فید پاسخ نداد (HTTP ${response.status})` });
        return;
      }
      xml = await response.text();
    } catch (error) {
      sendJson(res, 400, { error: `دسترسی به فید ممکن نشد: ${String(error?.message || error)}` });
      return;
    }
    if (!looksLikeFeed(xml)) {
      sendJson(res, 400, { error: 'این آدرس خوراک RSS یا Atom نیست' });
      return;
    }
    const items = feedItemCount(xml);
    if (!items) {
      sendJson(res, 400, { error: 'فید خالی است؛ خبری برای خواندن ندارد' });
      return;
    }
    const source = addSource({ ...parsed.source, custom: true });
    customState.sources = [...customState.sources.filter((item) => item.id !== source.id), source];
    await saveCustomConfig();
    sendJson(res, 200, { ok: true, source, items, note: 'از به‌روزرسانی بعدی خودکار در سایت دیده می‌شود' });
    return;
  }

  if (pathname === '/admin/api/custom/channel' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const parsed = parseChannelInput(body);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    const duplicate = TELEGRAM_CHANNELS.find(
      (channel) => String(channel.handle).toLowerCase() === parsed.channel.handle.toLowerCase()
    );
    if (duplicate) {
      sendJson(res, 409, { error: `این کانال از قبل در فهرست هست: ${duplicate.name}` });
      return;
    }
    let feed;
    try {
      feed = await fetchTelegramFeed(parsed.channel, { limit: 5 });
    } catch (error) {
      sendJson(res, 400, {
        error: `خواندن کانال ممکن نشد: ${String(error?.message || error)} — پیش‌نمایش عمومی کانال باید باز باشد`,
      });
      return;
    }
    const channel = addTelegramChannel({ ...parsed.channel, custom: true });
    customState.channels = [...customState.channels.filter((item) => item.id !== channel.id), channel];
    await saveCustomConfig();
    sendJson(res, 200, {
      ok: true,
      channel,
      title: feed.title || channel.name,
      posts: feed.posts.length,
      note: 'از به‌روزرسانی بعدی خودکار در بخش تلگرام دیده می‌شود',
    });
    return;
  }

  if (pathname === '/admin/api/custom/remove' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const kind = String(body.kind || '');
    const id = String(body.id || '');
    let removed = false;
    if (kind === 'source') {
      removed = removeSource(id);
      if (removed) customState.sources = customState.sources.filter((item) => item.id !== id);
    } else if (kind === 'channel') {
      removed = removeTelegramChannel(id);
      if (removed) customState.channels = customState.channels.filter((item) => item.id !== id);
    }
    if (!removed) {
      sendJson(res, 404, { error: 'این مورد پیدا نشد یا از فهرست پیش‌فرض است' });
      return;
    }
    await saveCustomConfig();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/admin/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (tooManyAttempts(ip)) {
      sendJson(res, 429, { error: 'تلاش‌های ناموفق زیاد؛ چند دقیقه بعد دوباره امتحان کن' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const ok = authState.record
      ? verifyPassword(body.password, authState.record)
      : passwordMatches(body.password, ADMIN_PASSWORD);
    if (!ok) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    loginAttempts.delete(ip);
    res.setHeader('Set-Cookie', sessionCookie(authState.secret));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/admin/api/password' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    if (!authState.record || !verifyPassword(body.current, authState.record)) {
      sendJson(res, 401, { error: 'رمز فعلی درست نیست' });
      return;
    }
    const problem = validateNewPassword(body.next);
    if (problem) {
      sendJson(res, 400, { error: problem });
      return;
    }
    if (String(body.next) !== String(body.confirm ?? body.next)) {
      sendJson(res, 400, { error: 'تکرار رمز تازه یکسان نیست' });
      return;
    }
    const record = {
      ...hashPassword(String(body.next)),
      secret: randomBytes(32).toString('hex'),
      updated_at: new Date().toISOString(),
    };
    await saveAuthRecord(record);
    // نشست‌های قبلی با راز تازه نامعتبر می‌شوند و برای همین مرورگر نشست تازه صادر می‌شود.
    res.setHeader('Set-Cookie', sessionCookie(authState.secret));
    sendJson(res, 200, { ok: true, updated_at: record.updated_at });
    return;
  }

  if (pathname === '/admin/logout') {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/admin/api/chat' && req.method === 'POST') {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message || error) });
      return;
    }
    try {
      const info = await getModelInfo();
      const lastUser = [...(Array.isArray(body.messages) ? body.messages : [])].reverse().find((m) => m.role === 'user');
      if (!info.available) {
        // بدون هیچ مدلی: پیام مدیر به یکی از دستورهای آماده تبدیل می‌شود
        const text = lastUser?.content;
        const intent = intentOf(text);
        const args = intent === 'news_search' ? { query: queryOf(text), limit: 5 } : {};
        if (!intent || (intent === 'news_search' && !args.query)) {
          sendJson(res, 200, {
            reply: [
              'بدون مدل کار می‌کنم. این دستورها را می‌شناسم:',
              '«وضعیت سایت» · «سلامت پخش» · «گزارش منابع» · «موضوع‌های داغ»',
              '«خبرهای دربارهٔ اقتصاد» (یا هر واژهٔ دیگر) · «به‌روزرسانی خبرها»',
            ].join('\n'),
            used: [],
            keyless: true,
          });
          return;
        }
        const result = await runTool(intent, args, adminToolContext());
        sendJson(res, 200, { reply: describeToolResult(intent, result), used: [intent], keyless: true });
        return;
      }
      const result = await runAssistant({
        messages: body.messages,
        config: { ...llmConfig(), model: info.model },
        context: adminToolContext(),
      });
      sendJson(res, 200, { ...result, keyless: false });
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message || error) });
    }
    return;
  }

  if (pathname === '/api/status') {
    const data = await readData();
    sendJson(res, 200, {
      running: state.running,
      last_error: state.last_error,
      last_started_at: state.last_started_at,
      last_finished_at: state.last_finished_at,
      next_run_at: state.next_run_at || (data ? new Date(new Date(data.generated_at).getTime() + INTERVAL_MS).toISOString() : null),
      interval_minutes: UPDATE_INTERVAL_MINUTES,
      generated_at: data?.generated_at || null,
      total: data?.stats?.total || 0,
      countdown_seconds: state.next_run_at ? Math.max(0, Math.round((new Date(state.next_run_at).getTime() - Date.now()) / 1000)) : null,
    });
    return;
  }

  if (pathname === '/api/markets') {
    const payload = await getLiveMarkets();
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === '/api/telegram') {
    const payload = await getLiveTelegram();
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === '/api/live') {
    const payload = await getLiveChannels();
    sendJson(res, 200, { ok: !payload.error, ...payload });
    return;
  }

  if (pathname === '/api/refresh' && (req.method === 'POST' || req.method === 'GET')) {
    const result = await refresh();
    sendJson(res, result.ok || result.running ? 200 : 500, result);
    return;
  }

  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(`retry: 5000\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ interval_minutes: UPDATE_INTERVAL_MINUTES })}\n\n`);
    state.clients.add(res);
    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      state.clients.delete(res);
    });
    return;
  }

  await serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`› داشبورد رصد خبر روی http://${HOST}:${PORT} فعال شد (به‌روزرسانی هر ${UPDATE_INTERVAL_MINUTES} دقیقه)`);
  scheduleRefresh().catch((error) => console.error('خطا در زمان‌بندی:', error));

  // هشدارها: یک‌بار کمی بعد از بالا آمدن سرور و بعد هر چند دقیقه یک‌بار
  const alertIntervalMs = Number(process.env.ALERT_INTERVAL_MINUTES || 10) * 60 * 1000;
  setTimeout(() => checkAlerts().catch(() => {}), 15000);
  setInterval(() => checkAlerts().catch(() => {}), alertIntervalMs);
});
