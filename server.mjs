// سرور داشبورد + به‌روزرسانی خودکار هر ۵ دقیقه
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runPipeline } from './pipeline.mjs';
import { fetchMarkets } from './src/markets.mjs';
import { fetchTelegramPosts } from './src/telegram.mjs';
import { UPDATE_INTERVAL_MINUTES } from './src/sources.mjs';

// نرخ‌های بازار جدا از خبرها و هر چند ثانیه یک‌بار خوانده می‌شوند تا تابلوی قیمت «لحظه‌ای» باشد.
const LIVE_MARKETS_TTL_MS = Number(process.env.MARKETS_TTL_SECONDS || 20) * 1000;
const liveMarkets = { at: 0, payload: null, inflight: null };

// پست‌های کانال تلگرام ایران اینترنشنال هر چند ثانیه خوانده می‌شوند تا همان لحظهٔ انتشار دیده شوند.
const LIVE_TELEGRAM_TTL_MS = Number(process.env.TELEGRAM_TTL_SECONDS || 15) * 1000;
const liveTelegram = { at: 0, payload: null, inflight: null };

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
      const payload = await fetchTelegramPosts({ limit: 20 });
      if (payload.posts.length) {
        liveTelegram.payload = payload;
        liveTelegram.at = Date.now();
      }
      return payload;
    } catch (error) {
      const data = await readData();
      return {
        channel: liveTelegram.payload?.channel || '',
        channel_url: liveTelegram.payload?.channel_url || 'https://t.me/IranintlTV',
        title: liveTelegram.payload?.title || 'ایران اینترنشنال',
        posts: liveTelegram.payload?.posts || data?.telegram?.posts || [],
        fetched_at: new Date().toISOString(),
        error: String(error?.message || error),
      };
    } finally {
      liveTelegram.inflight = null;
    }
  })();
  return liveTelegram.inflight;
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
