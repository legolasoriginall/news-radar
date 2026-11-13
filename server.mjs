// سرور داشبورد + به‌روزرسانی خودکار هر ۵ دقیقه
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runPipeline } from './pipeline.mjs';
import { fetchMarkets } from './src/markets.mjs';
import { fetchTelegramFeeds } from './src/telegram.mjs';
import { resolveLiveChannels, LIVE_CHANNELS } from './src/live.mjs';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  verifySession,
  parseCookies,
  passwordMatches,
  llmConfig,
  runAssistant,
} from './src/admin.mjs';
import { UPDATE_INTERVAL_MINUTES } from './src/sources.mjs';

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
const ADMIN_SECRET = process.env.ADMIN_SECRET || ADMIN_PASSWORD || 'news-radar-admin';
const loginAttempts = new Map();

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
  if (!ADMIN_PASSWORD) return false;
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(ADMIN_SECRET, cookies[SESSION_COOKIE]);
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/admin' || pathname === '/admin/') {
    await serveAdminPage(res);
    return;
  }

  if (pathname === '/admin/api/session') {
    const config = llmConfig();
    sendJson(res, 200, {
      authed: isAdmin(req),
      configured: Boolean(ADMIN_PASSWORD),
      hasKey: Boolean(config.apiKey),
      model: config.model || '',
      provider: config.provider || '',
    });
    return;
  }

  if (pathname === '/admin/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (tooManyAttempts(ip)) {
      sendJson(res, 429, { error: 'تلاش‌های ناموفق زیاد؛ چند دقیقه بعد دوباره امتحان کن' });
      return;
    }
    const body = await readJsonBody(req).catch(() => ({}));
    if (!ADMIN_PASSWORD || !passwordMatches(body.password, ADMIN_PASSWORD)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    loginAttempts.delete(ip);
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${createSession(ADMIN_SECRET)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    );
    sendJson(res, 200, { ok: true });
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
      const result = await runAssistant({
        messages: body.messages,
        context: {
          getStatus: async () => {
            const data = await readData();
            return {
              generated_at: data?.generated_at || null,
              total: data?.stats?.total || 0,
              stories: data?.stats?.stories || 0,
              multi_source: data?.stats?.multi_source || 0,
              telegram_posts: data?.stats?.telegram_posts || 0,
              markets: Array.isArray(data?.markets?.items) ? data.markets.items.length : 0,
              last_error: state.last_error || '',
              next_run_at: state.next_run_at || null,
            };
          },
          refresh: async () => refresh(),
        },
      });
      sendJson(res, 200, result);
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
});
