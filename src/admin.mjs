// دستیار مدیر: ورود رمزدار، نشست امضاشده و ابزارهای امن برای کارهای روزمرهٔ داشبورد.
// کلید مدل فقط در محیط سرور خوانده می‌شود و هرگز به مرورگر فرستاده نمی‌شود.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { LIVE_CHANNELS, probeStream } from './live.mjs';

export const SESSION_COOKIE = 'radar_admin';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** مقایسهٔ ثابت‌زمان رمز مدیر تا زمان پاسخ، طول رمز را لو ندهد. */
export function passwordMatches(input, expected) {
  if (!expected) return false;
  const left = Buffer.from(String(input ?? ''));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** رمز را با scrypt و نمک تصادفی هش می‌کند تا در فایل ذخیره شود، نه به‌صورت متن ساده. */
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash, algorithm: 'scrypt' };
}

export function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const expected = Buffer.from(String(record.hash), 'hex');
  if (!expected.length) return false;
  const actual = scryptSync(String(password ?? ''), String(record.salt), expected.length);
  return timingSafeEqual(actual, expected);
}

/** شرط‌های رمز تازه؛ خروجی رشتهٔ خطا یا رشتهٔ خالی. */
export function validateNewPassword(next) {
  const value = String(next ?? '');
  if (value.length < 8) return 'رمز تازه باید دست‌کم ۸ نویسه باشد';
  if (value.length > 128) return 'رمز تازه بیش از حد بلند است';
  if (!/[A-Za-z]/.test(value)) return 'رمز تازه باید حداقل یک حرف داشته باشد';
  if (!/[^A-Za-z]/.test(value)) return 'رمز تازه باید حداقل یک رقم یا نماد داشته باشد';
  return '';
}

export function signSession(secret, expiresAt) {
  return createHmac('sha256', String(secret)).update(String(expiresAt)).digest('hex');
}

export function createSession(secret, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  return `${expiresAt}.${signSession(secret, expiresAt)}`;
}

export function verifySession(secret, token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return false;
  const expiresAt = Number(parts[0]);
  const signature = parts[1];
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = signSession(secret, expiresAt);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

/** پیکربندی مدل از محیط سرور (Z.ai سازگار با OpenAI، یا OpenAI). */
export function llmConfig(env = process.env) {
  const zaiKey = env.ZAI_API_KEY || '';
  const openaiKey = env.OPENAI_API_KEY || '';
  if (zaiKey) {
    return {
      apiKey: zaiKey,
      baseUrl: env.ZAI_API_BASE || 'https://api.z.ai/api/paas/v4',
      model: env.ZAI_MODEL || 'glm-4-flash',
      provider: 'z.ai',
    };
  }
  if (openaiKey) {
    return {
      apiKey: openaiKey,
      baseUrl: env.OPENAI_API_BASE || 'https://api.openai.com/v1',
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      provider: 'openai',
    };
  }
  // بدون کلید: مدل محلی رایگان (Ollama) روی همان کامپیوتر، با اندپوینت سازگار با OpenAI
  return {
    apiKey: '',
    baseUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434/v1',
    model: env.OLLAMA_MODEL || 'llama3.2',
    provider: 'ollama',
  };
}

/** آیا Ollama روی همین کامپیوتر بالاست و چه مدل‌هایی دارد. */
export async function detectOllama({ baseUrl = 'http://127.0.0.1:11434/v1', fetcher = fetch, timeoutMs = 1500 } = {}) {
  try {
    const response = await fetcher(`${String(baseUrl).replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { available: false, models: [] };
    const payload = await response.json();
    const models = Array.isArray(payload?.data) ? payload.data.map((item) => item.id).filter(Boolean) : [];
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

/** یک دور گفت‌وگو با مدل؛ ورودی و خروجی سازگار با OpenAI Chat Completions. */
export async function chatWithTools({ messages, tools, config = llmConfig(), fetcher = fetch, timeoutMs = 60000 }) {
  const local = config.provider === 'ollama';
  if (!config.apiKey && !local) throw new Error('کلید مدل تنظیم نشده است');
  if (!config.baseUrl) throw new Error('آدرس مدل تنظیم نشده است');
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const response = await fetcher(`${String(config.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: local ? undefined : tools,
      tool_choice: local ? undefined : 'auto',
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.choices?.[0]?.message || { role: 'assistant', content: '' };
}

export const ADMIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'site_status',
      description: 'وضعیت فعلی سایت: زمان آخرین به‌روزرسانی داده‌ها، تعداد خبرها، قصه‌ها و پست‌های تلگرام.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stream_health',
      description: 'سلامت مسیرهای پخش زندهٔ شبکه‌ها را بررسی می‌کند و برای هر شبکه اولین مسیر سالم را برمی‌گرداند.',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'شناسهٔ شبکه (مثلاً iranintl)؛ خالی یعنی همه.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'refresh_site',
      description: 'یک به‌روزرسانی کامل خبرها را اجرا می‌کند (چند ثانیه طول می‌کشد).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

export const ADMIN_SYSTEM_PROMPT = [
  'تو دستیار مدیر داشبورد «رصد خبر» هستی: یک سایت فارسی رصد خبر، قیمت طلا و دلار،',
  'خبرهای تلگرام و پخش زندهٔ شبکه‌ها.',
  'فقط از داده‌ای که ابزارها برمی‌گردانند حرف بزن و اگر ابزاری شکست خورد صادقانه بگو.',
  'پاسخ‌ها کوتاه، فارسی و عملی باشند: اول کار انجام‌شده، بعد نکتهٔ مهم. هرگز رمز یا کلید نخواه.',
].join(' ');

const MAX_TOOL_ROUNDS = 4;

/** تشخیص سادهٔ خواستهٔ مدیر وقتی هیچ مدلی در دسترس نیست (حالت بدون کلید). */
export function intentOf(text) {
  const value = String(text || '');
  if (/به[\s\u200c-]*روز|بروز[\s\u200c-]*رسانی|آپدیت|update|refresh/i.test(value)) return 'refresh_site';
  if (/پخش|شبکه|استریم|سلامت|stream|live/i.test(value)) return 'stream_health';
  if (/وضعیت|آمار|چند خبر|چند قصه|تازه|status/i.test(value)) return 'site_status';
  if (/خطا|خراب|مشکل|error/i.test(value)) return 'site_status';
  return '';
}

function faNumber(value) {
  return Number(value || 0).toLocaleString('fa-IR');
}

/** خلاصهٔ فارسی نتیجهٔ ابزار برای حالت بدون مدل. */
export function describeToolResult(name, result) {
  if (!result || result.ok === false) {
    return `انجام نشد: ${(result && result.error) || 'خطای ناشناخته'}`;
  }
  if (name === 'site_status') {
    const when = result.generated_at ? new Date(result.generated_at).toLocaleString('fa-IR') : 'نامشخص';
    const lines = [
      `آخرین به‌روزرسانی داده‌ها: ${when}`,
      `خبرها: ${faNumber(result.total)} · قصه‌ها: ${faNumber(result.stories)} · چندمنبعی: ${faNumber(result.multi_source)}`,
      `پست‌های تلگرام: ${faNumber(result.telegram_posts)} · نرخ‌های بازار: ${faNumber(result.markets)}`,
      result.sources_total ? `منابع سالم: ${faNumber(result.sources_ok)} از ${faNumber(result.sources_total)}` : '',
      result.fresh_24h ? `خبرهای ۲۴ ساعت گذشته: ${faNumber(result.fresh_24h)}` : '',
    ];
    if (result.last_error) lines.push(`آخرین خطا: ${result.last_error}`);
    return lines.filter(Boolean).join('\n');
  }
  if (name === 'stream_health') {
    const rows = (result.channels || []).map((channel) =>
      channel.healthy ? `• ${channel.name}: سالم` : `• ${channel.name}: هیچ مسیری پاسخ نداد`
    );
    return rows.length ? ['سلامت پخش زنده:', ...rows].join('\n') : 'شبکه‌ای برای بررسی پیدا نشد.';
  }
  if (name === 'refresh_site') {
    return result.ok ? 'به‌روزرسانی انجام شد.' : `به‌روزرسانی انجام نشد: ${result.error || result.message || ''}`;
  }
  return 'انجام شد.';
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

/** ابزارها را اجرا می‌کند؛ وابستگی‌ها تزریق می‌شوند تا تست‌پذیر باشند. */
export async function runTool(name, args = {}, { getStatus, refresh, probe = probeStream, channels = LIVE_CHANNELS } = {}) {
  if (name === 'site_status') {
    if (typeof getStatus !== 'function') return { ok: false, error: 'وضعیت در دسترس نیست' };
    return { ok: true, ...(await getStatus()) };
  }
  if (name === 'stream_health') {
    const wanted = args.channel ? channels.filter((channel) => channel.id === args.channel) : channels;
    const results = [];
    for (const channel of wanted) {
      const attempted = [];
      let healthy = '';
      for (const url of (channel.fallbacks || []).slice(0, 3)) {
        attempted.push(url);
        // eslint-disable-next-line no-await-in-loop
        if (await probe(url, { timeoutMs: 6000 })) {
          healthy = url;
          break;
        }
      }
      results.push({ channel: channel.id, name: channel.name, healthy, attempted: attempted.length });
    }
    return { ok: true, channels: results };
  }
  if (name === 'refresh_site') {
    if (typeof refresh !== 'function') return { ok: false, error: 'به‌روزرسانی در دسترس نیست' };
    return { ok: true, ...(await refresh()) };
  }
  return { ok: false, error: `ابزار ناشناخته: ${name}` };
}

/** چرخهٔ گفت‌وگو با ابزار: تا چند دور مدل می‌تواند ابزار صدا بزند. */
export async function runAssistant({
  messages,
  config = llmConfig(),
  tools = ADMIN_TOOLS,
  execute = runTool,
  chat = chatWithTools,
  context = {},
}) {
  const conversation = [
    { role: 'system', content: ADMIN_SYSTEM_PROMPT },
    ...(Array.isArray(messages) ? messages.slice(-20) : []),
  ];
  const used = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const message = await chat({ messages: conversation, tools, config });
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      return { reply: String(message.content || '').trim(), used };
    }
    conversation.push({ role: 'assistant', content: message.content || '', tool_calls: calls });
    for (const call of calls) {
      const name = call?.function?.name || '';
      used.push(name);
      let result;
      try {
        result = await execute(name, safeJson(call?.function?.arguments), context);
      } catch (error) {
        result = { ok: false, error: String(error?.message || error) };
      }
      conversation.push({
        role: 'tool',
        tool_call_id: call.id || name,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
  }

  return { reply: 'پاسخ با ابزارها کامل نشد؛ لطفاً دوباره بپرس.', used };
}
