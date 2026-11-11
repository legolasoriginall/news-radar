// ترجمهٔ خبرهای انگلیسی به فارسی — نسخهٔ ۳ (دستهای و سریع)
// ترتیب: LLM اختیاری (اگر کلید تنظیم شود) → Google bulk → Bing → MyMemory → LibreTranslate
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const CACHE_FILE = path.resolve('.cache/translations.json');
const CHUNK_SIZE = 900;
const REAL_PROVIDERS = new Set(['google', 'llm', 'pollinations', 'bing', 'mymemory', 'libretranslate']);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// --- Google bulk (بدون کلید) ---
// --- Google bulk (بدون کلید، client=dict-chrome-ex) ---
const GOOGLE_CHARS_BUDGET = 6000; // بودجهٔ URL؛ سقف واقعی سرور ۱۶۴۰۹ کاراکتر است
const GOOGLE_LANES = clamp(Number(process.env.GOOGLE_TRANSLATE_LANES || 6), 1, 8);
const GOOGLE_RETRIES = 3;
const GOOGLE_MAX_BATCH = 60;
let googleBlockedUntil = 0;
let googleProbed = false;

// --- Bing (جایگزین) ---
const LANE_COUNT = clamp(Number(process.env.BING_SESSIONS || 5), 1, 5);
const LANE_GAP_MS = clamp(Number(process.env.BING_GAP_MS || 800), 600, 2000);

let cache = null;
let cacheDirty = false;
let myMemoryDisabled = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

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

/* ---------------------- پاک‌سازی متن و نیم‌فاصله ---------------------- */

function stripTags(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** بازگرداندن نیم‌فاصله‌های رایج فارسی که مترجم گاهی به فاصله تبدیل می‌کند. */
function normalizePersian(text) {
  let out = String(text || '');
  out = out.replace(/(^|[\s(«"])(می|نمی)\s+(?=[آ-ی])/g, (match, prefix, word) => `${prefix}${word}\u200c`);
  out = out.replace(
    /([آ-ی])\s+(ها|های|هایی|هایم|هایت|هایش|هایمان|هایتان|هایشان)(?=[\s،.:؛!؟)»"]|$)/g,
    '$1\u200c$2',
  );
  out = out.replace(/([آ-ی])\s+(تر|ترین)(?=[\s،.:؛!؟)»"]|$)/g, '$1\u200c$2');
  out = out.replace(/([هی])\s+ای(?=[\s،.:؛!؟)»"]|$)/g, '$1\u200cای');
  out = out.replace(/(^|[\s(«"])(بی)\s+(?=[آ-ی])/g, (match, prefix) => `${prefix}بی\u200c`);
  return out.replace(/\s+/g, ' ').trim();
}

/* ------------------------ Google bulk translate ------------------------ */

function batchChunks(chunks, budget = GOOGLE_CHARS_BUDGET) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const chunk of chunks) {
    const cost = encodeURIComponent(chunk).length + 3;
    if (current.length && size + cost > budget) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(chunk);
    size += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function googleBulkOnce(chunks) {
  if (Date.now() < googleBlockedUntil) throw new Error('Google موقتاً محدود شده است');
  const params = chunks.map((chunk) => 'q=' + encodeURIComponent(chunk)).join('&');
  const response = await fetch(
    `https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=fa&${params}`,
    {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(25000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    if (response.status === 429 || response.status === 403 || response.status === 503) {
      googleBlockedUntil = Date.now() + 30 * 60 * 1000;
    }
    throw new Error(`Google HTTP ${response.status}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('پاسخ غیر JSON از Google');
  }
  if (typeof data === 'string') data = [data];
  if (!Array.isArray(data) || data.length !== chunks.length) {
    throw new Error(`پاسخ Google نامعتبر (${Array.isArray(data) ? data.length : typeof data})`);
  }
  return data.map((item) => normalizePersian(String(item || '').trim()));
}

async function googleBatch(batch, depth = 0) {
  if (!batch.length) return [];
  let lastError = null;
  for (let attempt = 0; attempt < GOOGLE_RETRIES; attempt++) {
    try {
      const results = await googleBulkOnce(batch);
      if (results.every((text) => text)) return results;
      lastError = new Error('پاسخ خالی از Google');
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      const splittable = /400|نامعتبر|JSON/.test(message) && batch.length > 1 && depth < 6;
      if (splittable) {
        const middle = Math.ceil(batch.length / 2);
        const left = await googleBatch(batch.slice(0, middle), depth + 1);
        const right = await googleBatch(batch.slice(middle), depth + 1);
        return [...left, ...right];
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError || new Error('Google ناموفق');
}

/** یک درخواست کوچک برای اطمینان از سلامت مسیر Google در این اجرا. */
async function probeGoogle() {
  if (googleProbed) return;
  if (process.env.GOOGLE_TRANSLATE === '0') {
    googleBlockedUntil = Date.now() + 30 * 60 * 1000;
    console.log('   × Google با تنظیم GOOGLE_TRANSLATE=0 غیرفعال شد');
    return;
  }
  googleProbed = true;
  try {
    await googleBulkOnce(['probe']);
    console.log('   ✓ مترجم Google دسته‌ای در دسترس است');
  } catch (error) {
    googleBlockedUntil = Date.now() + 30 * 60 * 1000;
    console.log(`   × Google در دسترس نیست؛ Bing جایگزین می‌شود (${String(error?.message || error).slice(0, 60)})`);
  }
}

/* --------------------- LLM اختیاری (سازگار با OpenAI) -------------------- */

function llmConfig() {
  const explicit = String(process.env.NEWS_RADAR_LLM_PROVIDER || '').toLowerCase();
  const apiKey = process.env.NEWS_RADAR_LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey && explicit !== 'pollinations') return null;
  if (!apiKey) {
    return {
      apiKey: 'anonymous',
      baseUrl: String(process.env.NEWS_RADAR_LLM_BASE_URL || 'https://text.pollinations.ai/openai').replace(/\/$/, ''),
      model: process.env.NEWS_RADAR_LLM_MODEL || 'openai',
      provider: 'pollinations',
    };
  }
  return {
    apiKey,
    baseUrl: String(process.env.NEWS_RADAR_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.NEWS_RADAR_LLM_MODEL || 'gpt-4o-mini',
    provider: 'llm',
  };
}

async function llmBatch(chunks) {
  const cfg = llmConfig();
  if (!cfg) throw new Error('LLM تنظیم نشده است');
  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You translate English news headlines and snippets into natural, fluent Persian (Farsi). ' +
            'Preserve names of people, organizations and places in their common Persian form. ' +
            'Return ONLY a JSON object {"translations": ["...", "..."]} with exactly the same number of items, in the same order.',
        },
        { role: 'user', content: JSON.stringify({ items: chunks }) },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('پاسخ LLM نامعتبر');
  const parsed = JSON.parse(match[0]);
  const translations = Array.isArray(parsed.translations) ? parsed.translations.map((item) => String(item || '').trim()) : null;
  if (!translations || translations.length !== chunks.length || translations.some((text) => !text)) {
    throw new Error('تعداد ترجمه‌های LLM مطابق ورودی نیست');
  }
  return translations;
}

/* ------------------------- Bing (جایگزین) ------------------------- */

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

/* ------------------------------ orchestrator ---------------------------- */

async function translateChunkFallback(chunk) {
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

/**
 * ترجمهٔ گروهی متن‌ها.
 * خروجی: Map متن انگلیسی → { text, provider, quality, at?, cached? }
 */
export async function translateMany(texts, { concurrency = GOOGLE_LANES, onProgress, deadline = 0 } = {}) {
  const unique = [...new Set(texts.filter((text) => text && String(text).trim()))];
  const store = await loadCache();
  const output = new Map();
  const pending = [];

  for (const text of unique) {
    const cached = store[hash(text)];
    if (cached?.text && REAL_PROVIDERS.has(cached.provider)) {
      output.set(text, { ...cached, cached: true });
      continue;
    }
    pending.push({ text, key: hash(text), chunks: splitChunks(stripTags(text)) });
  }

  let done = output.size;
  const total = unique.length;
  const report = async () => {
    if (onProgress) onProgress(done, total);
  };
  await report();

  if (pending.length) {
    const chunkList = [...new Set(pending.flatMap((job) => job.chunks))];
    const chunkResults = new Map();
    const expired = () => deadline > 0 && Date.now() > deadline;

    // ۱) LLM (اگر کلید تنظیم شده باشد) — کیفیت بالاتر
    const llm = llmConfig();
    if (llm && chunkList.length) {
      const batches = batchChunks(chunkList, 2500);
      let index = 0;
      const workers = Array.from({ length: Math.min(2, batches.length) }, async () => {
        while (index < batches.length && !expired()) {
          const batch = batches[index++];
          try {
            const translations = await llmBatch(batch);
            batch.forEach((chunk, position) => {
              chunkResults.set(chunk, { text: translations[position], provider: 'llm', quality: 97, at: new Date().toISOString() });
            });
          } catch {
            // در صورت خطا، Google جایگزین می‌کند
          }
        }
      });
      await Promise.all(workers);
    }

    // ۲) Google bulk برای باقی‌مانده‌ها
    const remaining = chunkList.filter((chunk) => !chunkResults.has(chunk));
    if (remaining.length && !expired()) {
      await probeGoogle();
      const batches = batchChunks(remaining, GOOGLE_CHARS_BUDGET).flatMap((batch) => {
        const groups = [];
        for (let i = 0; i < batch.length; i += GOOGLE_MAX_BATCH) groups.push(batch.slice(i, i + GOOGLE_MAX_BATCH));
        return groups;
      });
      let index = 0;
      const limit = Math.max(1, Math.min(Number(concurrency) || GOOGLE_LANES, 6));
      const workers = Array.from({ length: Math.min(limit, batches.length) }, async () => {
        while (index < batches.length && !expired()) {
          const batch = batches[index++];
          try {
            const translations = await googleBatch(batch);
            batch.forEach((chunk, position) => {
              chunkResults.set(chunk, { text: translations[position], provider: 'google', quality: 92, at: new Date().toISOString() });
            });
          } catch {
            // بعداً با Bing/MyMemory ترجمه می‌شود
          }
        }
      });
      await Promise.all(workers);
    }

    // ۳) جایگزین تک‌متنی برای چانک‌های ناموفق (یا وقتی مهلت نزدیک است)
    const unresolved = chunkList.filter((chunk) => !chunkResults.has(chunk));
    if (unresolved.length) {
      let index = 0;
      const workers = Array.from({ length: Math.min(3, unresolved.length) }, async () => {
        while (index < unresolved.length && !expired()) {
          const chunk = unresolved[index++];
          const fallback = await translateChunkFallback(chunk);
          chunkResults.set(chunk, {
            ...fallback,
            quality: fallback.quality || Math.round(Math.min(1, Math.max(0.6, Number(fallback.match) || 0.9)) * 100),
          });
        }
      });
      await Promise.all(workers);
    }

    // ۴) سرهم‌بندی و ذخیرهٔ حافظه
    let sinceSave = 0;
    for (const job of pending) {
      const parts = job.chunks.map((chunk) => chunkResults.get(chunk)).filter((part) => part && part.text);
      const complete = parts.length === job.chunks.length;
      if (!complete) {
        output.set(job.text, { text: '', provider: 'none', quality: 0, cached: false });
      } else {
        const translated = normalizePersian(parts.map((part) => part.text).join(' '));
        const provider = parts[0].provider;
        const quality = Math.round(parts.reduce((acc, part) => acc + (part.quality || 90), 0) / parts.length);
        const entry = { text: translated, provider, quality, at: new Date().toISOString() };
        store[job.key] = entry;
        cacheDirty = true;
        output.set(job.text, { ...entry, cached: false });
      }
      done += 1;
      sinceSave += 1;
      if (sinceSave >= 20) {
        await saveCache();
        sinceSave = 0;
        await report();
      }
    }
    await report();
  }

  await saveCache();
  const skipped = unique.length - output.size;
  if (skipped > 0) console.log(`   ${skipped} متن بدون ترجمه ماند`);
  return output;
}

/** ترجمهٔ یک متن (برای استفادهٔ مستقیم/تست). */
export async function translateText(text) {
  const clean = String(text || '').trim();
  const result = await translateMany([clean]);
  return result.get(clean) || { text: '', provider: 'none', quality: 0 };
}
