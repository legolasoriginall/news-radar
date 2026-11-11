// ترجمهٔ خبرهای انگلیسی به فارسی — با حافظهٔ نهان پایدار و چند تأمین‌کننده
// ترتیب: LibreTranslate (در صورت تنظیم) → Bing → MyMemory → در انتظار ترجمه
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const CACHE_FILE = path.resolve('.cache/translations.json');
const CHUNK_SIZE = 900;
const REAL_PROVIDERS = new Set(['bing', 'mymemory', 'libretranslate']);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const LANE_COUNT = Math.max(1, Math.min(Number(process.env.BING_SESSIONS || 3), 5));
const LANE_GAP_MS = 1150;

let cache = null;
let cacheDirty = false;
let myMemoryDisabled = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadCache() {
  if (cache) return cache;
  try {
    cache = await readFile(CACHE_FILE, 'utf8').then((raw) => JSON.parse(raw));
  } catch {
    cache = {};
  }
  return cache;
}

export async function saveCache() {
  if (!cache || !cacheDirty) return;
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache), 'utf8');
  cacheDirty = false;
}

function hash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 24);
}

function splitChunks(text, size = CHUNK_SIZE) {
  if (text.length <= size) return [text];
  const sentences = text.split(/(?<=[.!?؟])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (!sentence) continue;
    if ((current + ' ' + sentence).trim().length > size) {
      if (current) chunks.push(current.trim());
      current = sentence.length > size ? sentence.slice(0, size) : sentence;
    } else {
      current = (current + ' ' + sentence).trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.slice(0, 3);
}

/* ------------------------- Bing (چند نشست موازی) ------------------------- */

const lanes = Array.from({ length: LANE_COUNT }, () => ({
  session: null,
  uses: 0,
  lastAt: 0,
  failures: 0,
  chain: Promise.resolve(),
}));

async function getSession(lane, force = false) {
  if (!force && lane.session && lane.session.expires > Date.now() && lane.uses < 10) return lane.session;
  const response = await fetch('https://www.bing.com/translator', {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Bing page HTTP ${response.status}`);
  const html = await response.text();
  const keyMatch = html.match(/params_AbusePreventionHelper\s*=\s*\[(\d+)\s*,\s*"([^"]+)"/);
  const igMatch = html.match(/IG\s*:\s*"([^"]+)"/);
  const iidMatch = html.match(/data-iid="(translator\.\d+)"/);
  if (!keyMatch || !igMatch) throw new Error('نشست Bing دریافت نشد');
  let cookies = '';
  try {
    cookies = (response.headers.getSetCookie?.() || []).map((cookie) => cookie.split(';')[0]).join('; ');
  } catch {
    cookies = '';
  }
  lane.session = {
    key: keyMatch[1],
    token: keyMatch[2],
    ig: igMatch[1],
    iid: iidMatch ? iidMatch[1] : 'translator.5023',
    cookies,
    expires: Date.now() + 45 * 60 * 1000,
  };
  lane.uses = 0;
  return lane.session;
}

async function bingInLane(lane, text) {
  if (lane.failures >= 12) throw new Error('Bing محدود شد');
  let session = await getSession(lane);
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, lane.lastAt + LANE_GAP_MS - Date.now());
    if (wait) await sleep(wait);
    lane.lastAt = Date.now();
    const body = new URLSearchParams({ fromLang: 'en', text, to: 'fa', token: session.token, key: session.key });
    const response = await fetch(
      `https://www.bing.com/ttranslatev3?isVertical=1&&IG=${encodeURIComponent(session.ig)}&IID=${encodeURIComponent(session.iid)}`,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://www.bing.com/translator',
          Origin: 'https://www.bing.com',
          ...(session.cookies ? { Cookie: session.cookies } : {}),
        },
        body: body.toString(),
        signal: AbortSignal.timeout(25000),
      },
    );
    const raw = await response.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    lane.uses += 1;

    if (json?.ShowCaptcha !== undefined || !Array.isArray(json)) {
      lane.failures += 1;
      session = await getSession(lane, true);
      await sleep(2200 + attempt * 1600);
      continue;
    }

    const translated = String(json?.[0]?.translations?.[0]?.text || '').trim();
    if (translated) {
      lane.failures = 0;
      return { text: translated, match: 0.95, provider: 'bing' };
    }
    lane.failures += 1;
    await sleep(1000);
  }
  throw new Error('Bing پاسخ نداد');
}

let laneCursor = 0;
function bingTranslate(text) {
  const lane = lanes[laneCursor++ % lanes.length];
  const run = lane.chain.then(() => bingInLane(lane, text), () => bingInLane(lane, text));
  lane.chain = run.then(() => undefined, () => undefined);
  return run;
}

/* ---------------------------- MyMemory ---------------------------- */

async function myMemoryTranslate(text) {
  if (myMemoryDisabled) throw new Error('سهمیهٔ MyMemory تمام شده است');
  const params = new URLSearchParams({ q: text, langpair: 'en|fa' });
  if (process.env.MYMEMORY_EMAIL) params.set('de', process.env.MYMEMORY_EMAIL);
  const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'NewsRadar/2.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  const status = Number(json?.responseStatus);
  const translated = String(json?.responseData?.translatedText || '').trim();
  if (/MYMEMORY WARNING|QUOTA/i.test(translated)) {
    myMemoryDisabled = true;
    throw new Error('سهمیهٔ MyMemory تمام شده است');
  }
  if (status !== 200 || !translated) throw new Error(json?.responseDetails || `status ${status}`);
  return { text: translated, match: Number(json?.responseData?.match) || 0.8, provider: 'mymemory' };
}

/* -------------------------- LibreTranslate ------------------------ */

async function libreTranslate(text) {
  const base = process.env.LIBRETRANSLATE_URL;
  if (!base) throw new Error('LIBRETRANSLATE_URL تنظیم نشده است');
  const response = await fetch(`${base.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: 'en', target: 'fa', format: 'text', api_key: process.env.LIBRETRANSLATE_KEY || undefined }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (!json.translatedText) throw new Error('پاسخ خالی');
  return { text: json.translatedText, match: 0.9, provider: 'libretranslate' };
}

async function translateChunk(chunk) {
  const providers = [];
  if (process.env.LIBRETRANSLATE_URL) providers.push(libreTranslate);
  providers.push(bingTranslate, myMemoryTranslate);

  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await provider(chunk);
        if (result.text) return result;
        break;
      } catch {
        await sleep(350 + attempt * 700);
      }
    }
  }
  return { text: '', provider: 'none', quality: 0 };
}

export async function translateText(text) {
  const clean = String(text || '').trim();
  if (!clean) return { text: '', provider: 'none', quality: 0, cached: true };
  const key = hash(clean);
  const store = await loadCache();
  const cached = store[key];
  if (cached?.text && REAL_PROVIDERS.has(cached.provider)) return { ...cached, cached: true };

  const chunks = splitChunks(clean);
  const results = [];
  for (const chunk of chunks) {
    const result = await translateChunk(chunk);
    if (!result.text) return { text: '', provider: 'none', quality: 0, cached: false };
    results.push(result);
  }

  const translated = results.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim();
  const provider = results[0].provider;
  const match = results.reduce((acc, r) => acc + (r.match || 0), 0) / results.length;
  const entry = {
    text: translated,
    provider,
    quality: Math.round(Math.max(0.6, Math.min(1, match)) * 100),
    at: new Date().toISOString(),
  };
  store[key] = entry;
  cacheDirty = true;
  return { ...entry, cached: false };
}

export async function translateMany(texts, { concurrency = LANE_COUNT, onProgress, deadline = 0 } = {}) {
  const unique = [...new Set(texts.filter((t) => t && t.trim()))];
  const output = new Map();
  let done = 0;
  let index = 0;
  let skipped = 0;

  async function worker() {
    while (index < unique.length) {
      if (deadline && Date.now() > deadline) {
        skipped = unique.length - index;
        index = unique.length;
        break;
      }
      const current = unique[index++];
      try {
        output.set(current, await translateText(current));
      } catch {
        output.set(current, { text: '', provider: 'none', quality: 0 });
      }
      done += 1;
      if (done % 15 === 0) await saveCache();
      if (onProgress && (done % 20 === 0 || done === unique.length)) onProgress(done, unique.length);
    }
  }

  const limit = Math.max(1, Math.min(Number(process.env.TRANSLATE_CONCURRENCY || concurrency), 5));
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, unique.length)) }, worker));
  await saveCache();
  if (skipped) console.log(`   ${skipped} متن برای به‌روزرسانی بعدی باقی ماند`);
  return output;
}
