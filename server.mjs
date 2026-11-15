// سرور داشبورد + به‌روزرسانی خودکار هر ۵ دقیقه
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runPipeline, probeSource } from './pipeline.mjs';
import { fetchMarkets, setStaleHours } from './src/markets.mjs';
import { fetchTelegramFeeds, fetchTelegramFeed, addTelegramChannel, removeTelegramChannel, TELEGRAM_CHANNELS } from './src/telegram.mjs';
import { parseSourceInput, parseChannelInput, looksLikeFeed, feedItemCount } from './src/custom.mjs';
import { firstUrlIn } from './src/web.mjs';
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

// تنظیمات قابل تغییر از پنل مدیر (مثلاً آستانهٔ سکوت خبری) در این فایل می‌ماند
// تا با ری‌استارت گم نشود؛ در گیت نیست و مقدار پیش‌فرض از ALERT_SILENT_HOURS می‌آید.
const SETTINGS_FILE = path.join(ROOT, '.settings.json');
const SILENT_HOURS_MIN = 1;
const SILENT_HOURS_MAX = 720;
const DEFAULT_SILENT_HOURS = 24;
// آستانهٔ کهنه‌بودن نرخ‌ها؛ کوچک‌تر یعنی زودتر سراغ منبع دوم می‌رویم.
const PRICE_STALE_HOURS_MIN = 1;
const PRICE_STALE_HOURS_MAX = 168;
const DEFAULT_PRICE_STALE_HOURS = 48;

function clampSilentHours(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_SILENT_HOURS;
  return Math.min(SILENT_HOURS_MAX, Math.max(SILENT_HOURS_MIN, Math.round(num)));
}

function clampPriceStaleHours(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_PRICE_STALE_HOURS;
  return Math.min(PRICE_STALE_HOURS_MAX, Math.max(PRICE_STALE_HOURS_MIN, Math.round(num)));
}

function loadSettings() {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      silent_hours: clampSilentHours(parsed.silent_hours ?? process.env.ALERT_SILENT_HOURS),
      price_stale_hours: clampPriceStaleHours(parsed.price_stale_hours ?? process.env.MARKET_STALE_HOURS),
    };
  } catch {
    return {
      silent_hours: clampSilentHours(process.env.ALERT_SILENT_HOURS),
      price_stale_hours: clampPriceStaleHours(process.env.MARKET_STALE_HOURS),
    };
  }
}

let settings = loadSettings();
setStaleHours(settings.price_stale_hours);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const INTERVAL_MS = UPDATE_INTERVAL_MINUTES * 60 * 1000;
// setTimeout/setInterval بیش از ۲^۳۱−۱ میلی‌ثانیه را نمی‌پذیرند و بلافاصله اجرا می‌شوند؛
// پس تأخیرها همیشه محدود می‌شوند تا تنظیم بازهٔ خیلی بزرگ باعث حلقهٔ به‌روزرسانی نشود.
const MAX_TIMEOUT_MS = 2147483647;
const clampDelay = (ms) => Math.min(Math.max(0, Number.isFinite(ms) ? ms : INTERVAL_MS), MAX_TIMEOUT_MS);

// --- محدودیت نرخ ---------------------------------------------------------
// هر مسیر عمومی/مدیر سهم خودش را از یک پنجرهٔ زمانی دارد تا یک کلاینت نتواند
// با درخواست پیاپی، سرور را به کار سنگین (به‌روزرسانی، فچ بیرونی، اتصال زنده) وادار کند.
const RATE_WINDOWS = {
  api: { limit: 180, windowMs: 60 * 1000 },
  live: { limit: 30, windowMs: 60 * 1000 },
  refresh: { limit: 5, windowMs: 60 * 1000 },
  sourcecheck: { limit: 20, windowMs: 60 * 1000 },
  login: { limit: 20, windowMs: 5 * 60 * 1000 },
  admin: { limit: 120, windowMs: 60 * 1000 },
};
const rateBuckets = new Map();

function clientIp(req) {
  const direct = String(req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  // آدرس واقعی فقط وقتی از هدر خوانده می‌شود که سرور پشت پروکسی مطمئن باشد؛
  // وگرنه هر کلاینتی می‌تواند با X-Forwarded-For سهم بقیه را بخورد.
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return direct;
}

function hitRate(key, limit, windowMs) {
  const now = Date.now();
  // سقف سخت: کلاینتی که با آدرس‌های تازه سطل می‌سازد نباید حافظه را بی‌نهایت کند.
  if (rateBuckets.size > 5000) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
    }
    while (rateBuckets.size > 5000) {
      const oldest = rateBuckets.keys().next().value;
      rateBuckets.delete(oldest);
    }
  }
  let entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, entry);
  }
  entry.count += 1;
  return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

function rateClassFor(pathname) {
  if (pathname === '/admin/login') return 'login';
  if (pathname === '/api/live') return 'live';
  if (pathname === '/api/sources/check') return 'sourcecheck';
  if (pathname === '/api/refresh') return 'refresh';
  if (pathname.startsWith('/api/')) return 'api';
  if (pathname.startsWith('/admin/')) return 'admin';
  return '';
}

function enforceRateLimit(req, res, pathname) {
  const bucket = rateClassFor(pathname);
  if (!bucket) return true;
  const config = RATE_WINDOWS[bucket];
  const result = hitRate(`${bucket}:${clientIp(req)}`, config.limit, config.windowMs);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfter));
  sendJson(res, 429, { error: 'درخواست‌های زیاد؛ چند لحظه بعد دوباره امتحان کن', retry_after: result.retryAfter });
  return false;
}

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

// --- هدرهای امنیتی --------------------------------------------------------
// اسکریپت‌ها nonce دارند و 'unsafe-inline' از script-src حذف شده است. هر پاسخ HTML
// یک nonce تازه می‌گیرد و سرور آن را در تگ‌های <script> درون‌خطی می‌گذارد؛ 'strict-dynamic'
// اجازه می‌دهد همان اسکریپت مورد اعتماد، hls.js را از CDN یا مسیر محلی بارگذاری کند.
// استایل‌ها هنوز درون‌خطی‌اند، پس style-src همان 'unsafe-inline' را نگه می‌دارد.
function buildCsp(nonce, isAdminPage) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' https: blob:",
    "font-src 'self' data: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  // پنل مدیر فقط در قاب هم‌مبدأ (داخل خود داشبورد) مجاز است
  if (isAdminPage) directives.push("frame-ancestors 'self'");
  return directives.join('; ');
}

// nonce را در همهٔ تگ‌های <script> بدون nonce می‌گذارد (درون‌خطی و دارای src)
function withCspNonce(html, nonce) {
  // nonce به همهٔ تگ‌های script بدون nonce اضافه می‌شود (حتی script با src) تا با
  // strict-dynamic اسکریپت‌های همین مبدا مثل src/hls-loader.js هم مجاز باشند.
  return String(html).replace(/<script(?![^>]*\bnonce=)([^>]*)>/gi, (tag, attrs) => `<script nonce="${nonce}"${attrs}>`);
}

function isSecureRequest(req) {
  if (req.socket && req.socket.encrypted) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
}

function applySecurityHeaders(req, res, pathname) {
  const isAdminPage = pathname === '/admin' || pathname === '/admin/';
  // هر پاسخ یک nonce تازه می‌گیرد؛ بدنهٔ HTML با همین مقدار تزریق می‌شود.
  const nonce = randomBytes(16).toString('base64');
  res.cspNonce = nonce;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', buildCsp(nonce, isAdminPage));
  if (isAdminPage) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Robots-Tag', 'noindex');
  }
  // HSTS فقط روی درخواست HTTPS تا اجرای محلی با http خراب نشود.
  if (isSecureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

const state = {
  running: false,
  last_error: '',
  last_started_at: '',
  last_finished_at: '',
  last_manual_at: 0,
  next_run_at: '',
  clients: new Set(),
};

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of state.clients) {
    try {
      // کلاینت کندی که بافر می‌فرستد نباید حافظه را پر کند؛ قطعش می‌کنیم.
      if (res.writableLength > 512 * 1024) {
        state.clients.delete(res);
        res.destroy();
        continue;
      }
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
  const nextAt = new Date(state.next_run_at).getTime();
  setTimeout(function tick() {
    const startedAt = Date.now();
    refresh().finally(() => {
      const elapsed = Date.now() - startedAt;
      setTimeout(tick, clampDelay(Math.max(5000, INTERVAL_MS - elapsed)));
    });
  }, clampDelay(Number.isFinite(nextAt) ? Math.max(5000, nextAt - Date.now()) : INTERVAL_MS));
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
        refreshed_count: Number(result.refreshed_count) || 0,
        source: result.source || '',
        items: result.items || [],
        warnings: result.warnings || [],
        providers: result.providers || [],
        divergence_threshold_percent: result.divergence_threshold_percent,
        stale_threshold_hours: result.stale_threshold_hours,
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

function sessionCookie(secret, secure = false) {
  const flags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  return `${SESSION_COOKIE}=${createSession(secret)}; ${flags}${secure ? '; Secure' : ''}`;
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

async function serveHtmlPage(res, file, missingText) {
  try {
    const raw = await readFile(path.join(ROOT, file));
    const body = res.cspNonce
      ? Buffer.from(withCspNonce(raw.toString('utf8'), res.cspNonce), 'utf8')
      : raw;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missingText);
  }
}

function serveAdminPage(res) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  return serveHtmlPage(res, 'admin.html', 'صفحهٔ مدیر پیدا نشد');
}

function serveStatusPage(res) {
  return serveHtmlPage(res, 'status.html', 'صفحهٔ وضعیت پیدا نشد');
}

// فقط همین فایل‌ها و پوشه‌ها عمومی‌اند؛ هر چیز دیگری (کد سرور، پیکربندی،
// فایل‌های نقطه‌ای و پوشه‌های داخلی) حتی با آدرس مستقیم هم سرو نمی‌شود.
const PUBLIC_FILES = new Set(['/index.html', '/status.html', '/data.json', '/news.xlsx', '/favicon.svg', '/src/hls-loader.js']);

// سیاست کش دارایی‌های ثابت: آدرسِ نسخه‌دار (?v=…) کش طولانی و immutable می‌گیرد؛
// خود آدرس بدون نسخه کوتاه و قابل‌بازبینی می‌ماند تا لینک قدیمی محتوای کهنه ندهد.
const VERSIONED_ASSETS = new Map([
  ['/news.xlsx', { versioned: 315360000, plain: 'public, max-age=300, must-revalidate' }],
  ['/favicon.svg', { versioned: 315360000, plain: 'public, max-age=86400' }],
]);
const PUBLIC_DIRS = ['/vendor/'];

function isPublicAsset(relative) {
  if (PUBLIC_FILES.has(relative)) return true;
  return PUBLIC_DIRS.some((dir) => relative.startsWith(dir) && relative.length > dir.length);
}

async function serveStatic(req, res, pathname, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('آدرس نامعتبر است');
    return;
  }
  if (relative === '/' || relative === '') relative = '/index.html';
  if (!isPublicAsset(relative)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('یافت نشد');
    return;
  }
  const filePath = path.join(ROOT, relative);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (!filePath.startsWith(rootPrefix) || relative.split('/').some((part) => part.startsWith('.'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const raw = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    // HTML هر بار nonce تازه می‌گیرد، پس نباید کش شود؛ بقیهٔ فایل‌ها:
    // vendor با نسخه در آدرس → کش یک‌سالهٔ immutable، بقیه کوتاه‌مدت.
    const body = isHtml && res.cspNonce
      ? Buffer.from(withCspNonce(raw.toString('utf8'), res.cspNonce), 'utf8')
      : raw;
    const isVendorAsset = relative.startsWith('/vendor/');
    const isVersioned = Boolean(url && url.searchParams.has('v'));
    // کتابخانه‌های vendor با نسخه در آدرس لود می‌شوند (مثل hls.min.js?v=1.5.20)؛
    // پس می‌توان با خیال راحت ده سال کش کرد: تا وقتی نسخه عوض نشود، هیچ
    // بازدیدی دوباره فایل را نمی‌گیرد و آپدیت کتابخانه با تغییر ?v یک آدرس تازه می‌سازد.
    const VENDOR_CACHE_SECONDS = 315360000; // ۱۰ سال
    const assetRule = VERSIONED_ASSETS.get(relative);
    let longCacheSeconds = 0;
    let cacheControl;
    if (isHtml || ext === '.json') {
      cacheControl = 'no-store';
    } else if (isVendorAsset) {
      cacheControl = `public, max-age=${VENDOR_CACHE_SECONDS}, immutable`;
      longCacheSeconds = VENDOR_CACHE_SECONDS;
    } else if (assetRule && isVersioned) {
      cacheControl = `public, max-age=${assetRule.versioned}, immutable`;
      longCacheSeconds = assetRule.versioned;
    } else if (assetRule) {
      cacheControl = assetRule.plain;
    } else {
      cacheControl = 'public, max-age=60';
    }
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    };
    // Expires هم فرستاده می‌شود تا کش‌های قدیمی‌تری که به max-age اعتماد نمی‌کنند،
    // همین بازهٔ طولانی را ببینند.
    if (longCacheSeconds) {
      headers.Expires = new Date(Date.now() + longCacheSeconds * 1000).toUTCString();
    }
    res.writeHead(200, headers);
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
    settingsGet: async () => ({ silent_hours: settings.silent_hours, price_stale_hours: settings.price_stale_hours }),
    settingsSet: async ({ silent_hours, price_stale_hours } = {}) => {
      if (silent_hours != null) {
        const n = Number(silent_hours);
        if (!Number.isFinite(n) || n < 1 || n > 168) return { ok: false, error: 'سکوت خبری باید بین ۱ تا ۱۶۸ ساعت باشد' };
        settings.silent_hours = Math.round(n);
      }
      if (price_stale_hours != null) {
        const n = Number(price_stale_hours);
        if (!Number.isFinite(n) || n < 1 || n > 168) return { ok: false, error: 'کهنه‌بودن قیمت باید بین ۱ تا ۱۶۸ ساعت باشد' };
        settings.price_stale_hours = Math.round(n);
        setStaleHours(settings.price_stale_hours);
      }
      try { await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8'); } catch (error) { return { ok: false, error: 'ذخیرهٔ تنظیمات ناموفق بود: ' + String(error?.message || error) }; }
      return { ok: true, silent_hours: settings.silent_hours, price_stale_hours: settings.price_stale_hours };
    },
    listCustom: async () => ({ sources: customState.sources, channels: customState.channels }),
    removeCustom: async ({ kind, id } = {}) => {
      const k = String(kind || '');
      const target = String(id || '');
      let removed = false;
      if (k === 'source') {
        removed = removeSource(target);
        if (removed) customState.sources = customState.sources.filter((item) => item.id !== target);
      } else if (k === 'channel') {
        removed = removeTelegramChannel(target);
        if (removed) customState.channels = customState.channels.filter((item) => item.id !== target);
      }
      if (!removed) return { ok: false, error: 'پیدا نشد یا از فهرست پیش‌فرض است' };
      await saveCustomConfig();
      return { ok: true };
    },
    addSource: async ({ name, url, lang, weight } = {}) => {
      const parsed = parseSourceInput({ name, url, lang, weight });
      if (!parsed.ok) return { ok: false, error: parsed.error };
      let xml = '';
      try {
        const response = await fetch(parsed.source.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsRadar/1.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) return { ok: false, error: `آدرس فید پاسخ نداد (HTTP ${response.status})` };
        xml = await response.text();
      } catch (error) {
        return { ok: false, error: `دسترسی به فید ممکن نشد: ${String(error?.message || error)}` };
      }
      if (!looksLikeFeed(xml)) return { ok: false, error: 'این آدرس خوراک RSS یا Atom نیست' };
      const items = feedItemCount(xml);
      if (!items) return { ok: false, error: 'فید خالی است' };
      const source = addSource({ ...parsed.source, custom: true });
      customState.sources = [...customState.sources.filter((item) => item.id !== source.id), source];
      await saveCustomConfig();
      return { ok: true, source, items };
    },
    addChannel: async ({ handle, name, weight } = {}) => {
      const parsed = parseChannelInput({ handle, name, weight });
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const duplicate = TELEGRAM_CHANNELS.find((channel) => String(channel.handle).toLowerCase() === parsed.channel.handle.toLowerCase());
      if (duplicate) return { ok: false, error: `این کانال از قبل در فهرست هست: ${duplicate.name}` };
      let feed;
      try {
        feed = await fetchTelegramFeed(parsed.channel, { limit: 5 });
      } catch (error) {
        return { ok: false, error: `خواندن کانال ممکن نشد: ${String(error?.message || error)}` };
      }
      const channel = addTelegramChannel({ ...parsed.channel, custom: true });
      customState.channels = [...customState.channels.filter((item) => item.id !== channel.id), channel];
      await saveCustomConfig();
      return { ok: true, channel, title: feed.title || channel.name, posts: feed.posts.length };
    },
    alertsList: async () => ({ alerts: alertState.data.alerts || [], last_check_at: alertState.last_check_at || '' }),
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
      silentHours: settings.silent_hours,
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
  let saved = null;
  for (const file of [CUSTOM_FILE, path.join(path.resolve('.'), 'custom-sources.json')]) {
    try { saved = JSON.parse(await readFile(file, 'utf8')); break; } catch { /* try next */ }
  }
  if (!saved) return;
  try {
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

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // محدودیت نرخ پیش از هر پردازش، تا درخواست پیاپی به کار سنگین نرسد.
  if (!enforceRateLimit(req, res, pathname)) return;

  // دفاع CSRF: درخواست تغییردهندهٔ پنل مدیر باید از همان میزبان صفحه باشد.
  // مرورگرها برای POST همیشه Origin می‌فرستند؛ نبودنش (مثلاً curl) مشکلی نیست
  // چون این مسیرها بدون نشست معتبر ۴۰۱ می‌گیرند.
  if (req.method === 'POST' && (pathname === '/admin/login' || pathname.startsWith('/admin/api/'))) {
    const origin = String(req.headers.origin || '');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (!originHost || originHost !== String(req.headers.host || '')) {
        sendJson(res, 403, { error: 'درخواست از مبدأ نامعتبر رد شد' });
        return;
      }
    }
  }

  if (pathname === '/admin' || pathname === '/admin/') {
    await serveAdminPage(res);
    return;
  }

  // مسیر قدیمی favicon: مرورگرها خودشان /favicon.ico را می‌خواهند؛ به آیکون نسخه‌دار هدایت می‌شود.
  if (pathname === '/favicon.ico') {
    res.writeHead(301, {
      Location: '/favicon.svg?v=1',
      'Cache-Control': 'public, max-age=315360000, immutable',
    });
    res.end();
    return;
  }

  if (pathname === '/status' || pathname === '/status/') {
    await serveStatusPage(res);
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

  if (pathname === '/admin/api/settings') {
    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        settings,
        limits: {
          min: SILENT_HOURS_MIN,
          max: SILENT_HOURS_MAX,
          price_min: PRICE_STALE_HOURS_MIN,
          price_max: PRICE_STALE_HOURS_MAX,
        },
      });
      return;
    }
    if (req.method === 'POST') {
      if (!isAdmin(req)) {
        sendJson(res, 401, { error: 'دسترسی مدیر لازم است' });
        return;
      }
      const body = await readJsonBody(req, 4096).catch(() => ({}));
      const next = { ...settings };
      let changed = false;
      if (body.silent_hours !== undefined) {
        const hours = Number(body.silent_hours);
        if (!Number.isFinite(hours) || hours < SILENT_HOURS_MIN || hours > SILENT_HOURS_MAX) {
          sendJson(res, 400, { error: `عدد ساعت سکوت باید بین ${SILENT_HOURS_MIN} و ${SILENT_HOURS_MAX} باشد` });
          return;
        }
        next.silent_hours = Math.round(hours);
        changed = true;
      }
      if (body.price_stale_hours !== undefined) {
        const hours = Number(body.price_stale_hours);
        if (!Number.isFinite(hours) || hours < PRICE_STALE_HOURS_MIN || hours > PRICE_STALE_HOURS_MAX) {
          sendJson(res, 400, {
            error: `آستانهٔ کهنه‌بودن قیمت باید بین ${PRICE_STALE_HOURS_MIN} و ${PRICE_STALE_HOURS_MAX} ساعت باشد`,
          });
          return;
        }
        next.price_stale_hours = Math.round(hours);
        changed = true;
      }
      if (!changed) {
        sendJson(res, 400, { error: 'هیچ تنظیمی در درخواست نبود' });
        return;
      }
      settings = next;
      setStaleHours(settings.price_stale_hours);
      // نرخ‌های کش‌شده با آستانهٔ قبلی سنجیده شده‌اند؛ کش دور ریخته می‌شود.
      liveMarkets.payload = null;
      liveMarkets.at = 0;
      try {
        await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
      } catch (error) {
        sendJson(res, 500, { error: 'ذخیرهٔ تنظیمات ناموفق بود: ' + String(error?.message || error) });
        return;
      }
      sendJson(res, 200, { ok: true, settings });
      return;
    }
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'متد پشتیبانی نمی‌شود' });
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
    res.setHeader('Set-Cookie', sessionCookie(authState.secret, isSecureRequest(req)));
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
    res.setHeader('Set-Cookie', sessionCookie(authState.secret, isSecureRequest(req)));
    sendJson(res, 200, { ok: true, updated_at: record.updated_at });
    return;
  }

  if (pathname === '/admin/logout') {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecureRequest(req) ? '; Secure' : ''}`
    );
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
        const args = intent === 'news_search' || intent === 'web_search'
          ? { query: queryOf(text), limit: 5 }
          : intent === 'read_url'
            ? { url: firstUrlIn(text) }
            : {};
        const missing = (intent === 'news_search' || intent === 'web_search') && !args.query
          || intent === 'read_url' && !args.url;
        if (!intent || missing) {
          sendJson(res, 200, {
            reply: [
              'بدون مدل کار می‌کنم. این دستورها را می‌شناسم:',
              '«وضعیت سایت» · «سلامت پخش» · «گزارش منابع» · «موضوع‌های داغ»',
              '«خبرهای دربارهٔ اقتصاد» · «از اینترنت دربارهٔ قیمت دلار جستجو کن»',
              '«این لینک را بخوان: https://…» · «به‌روزرسانی خبرها»',
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
      silent_hours: settings.silent_hours,
      price_stale_hours: settings.price_stale_hours,
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

  if (pathname === '/api/sources/check' && req.method === 'POST') {
    // همان لحظه یک فید مشخص را دوباره می‌خوانیم؛ آدرس از پیکربندی سرور می‌آید
    // نه از مرورگر، تا این مسیر به ابزار درخواست دلخواه (SSRF) تبدیل نشود.
    const body = await readJsonBody(req, 4096).catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!id) {
      sendJson(res, 400, { ok: false, error: 'شناسهٔ منبع لازم است' });
      return;
    }
    const result = await probeSource(id);
    if (!result) {
      sendJson(res, 404, { ok: false, error: 'منبعی با این شناسه در پیکربندی نیست' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, { ok: true, source: result });
    return;
  }

  if (pathname === '/api/refresh' && req.method === 'POST') {
    const now = Date.now();
    if (state.last_manual_at && now - state.last_manual_at < 15000) {
      sendJson(res, 429, { ok: false, error: 'به‌روزرسانی دستی خیلی زود تکرار شد؛ چند لحظه بعد دوباره امتحان کن' });
      return;
    }
    state.last_manual_at = now;
    const result = await refresh();
    sendJson(res, result.ok || result.running ? 200 : 500, result);
    return;
  }

  if (pathname === '/api/events') {
    // اتصال زنده گران است (همیشه باز می‌ماند و هر کلاینت یک سوکت می‌گیرد)؛
    // پس هم سقف کلی و هم سقف هر IP دارد تا حافظه با هزار اتصال پر نشود.
    const ip = clientIp(req);
    const perIp = ssePerIp.get(ip) || 0;
    if (state.clients.size >= SSE_MAX_TOTAL || perIp >= SSE_MAX_PER_IP) {
      res.setHeader('Retry-After', '30');
      sendJson(res, 429, { error: 'اتصال‌های زندهٔ همزمان زیاد است؛ چند لحظه بعد دوباره وصل شو' });
      return;
    }
    ssePerIp.set(ip, perIp + 1);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 5000\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ interval_minutes: UPDATE_INTERVAL_MINUTES })}\n\n`);
    state.clients.add(res);
    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 25000);
    let closed = false;
    req.on('close', () => {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      state.clients.delete(res);
      const left = (ssePerIp.get(ip) || 1) - 1;
      if (left <= 0) ssePerIp.delete(ip);
      else ssePerIp.set(ip, left);
    });
    return;
  }

  await serveStatic(req, res, pathname, url);
}

const server = createServer((req, res) => {
  // هدرهای امنیتی برای همهٔ پاسخ‌ها (صفحه، API و فایل) پیش از هر نوشتن تنظیم می‌شوند.
  const headerPath = String(req.url || '/').split('?')[0] || '/';
  applySecurityHeaders(req, res, headerPath);
  handleRequest(req, res).catch((error) => {
    console.error('✖ خطای درخواست:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'خطای داخلی سرور' }));
    } else {
      try { res.end(); } catch { /* ignore */ }
    }
  });
});

server.on('error', (error) => {
  console.error(`✖ سرور روی ${HOST}:${PORT} بالا نیامد:`, error?.message || error);
  process.exitCode = 1;
});

// سقف اتصال‌های زندهٔ SSE
const SSE_MAX_TOTAL = Number(process.env.SSE_MAX_TOTAL || 20);
const SSE_MAX_PER_IP = Number(process.env.SSE_MAX_PER_IP || 6);
const ssePerIp = new Map();

// درخواست‌های کند و هدرهای حجیم زودتر بسته می‌شوند؛ اتصال زندهٔ SSE فقط پاسخ
// را جریان می‌دهد و از این محدودیت آسیب نمی‌بیند.
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 10000;

// پاک‌سازی دوره‌ای سطل‌های نرخ و ثبت تلاش‌های ورود تا با IPهای تازه بی‌نهایت بزرگ نشوند.
const rateSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets) {
    if (entry.resetAt <= now) rateBuckets.delete(key);
  }
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.since > 10 * 60 * 1000) loginAttempts.delete(ip);
  }
}, 60000);
if (typeof rateSweep.unref === 'function') rateSweep.unref();

server.listen(PORT, HOST, () => {
  console.log(`› داشبورد رصد خبر روی http://${HOST}:${PORT} فعال شد (به‌روزرسانی هر ${UPDATE_INTERVAL_MINUTES} دقیقه)`);
  scheduleRefresh().catch((error) => console.error('خطا در زمان‌بندی:', error));

  // هشدارها: یک‌بار کمی بعد از بالا آمدن سرور و بعد هر چند دقیقه یک‌بار
  const alertIntervalMs = Number(process.env.ALERT_INTERVAL_MINUTES || 10) * 60 * 1000;
  setTimeout(() => checkAlerts().catch(() => {}), 15000);
  setInterval(() => checkAlerts().catch(() => {}), Math.min(Math.max(60000, alertIntervalMs), MAX_TIMEOUT_MS));
});
