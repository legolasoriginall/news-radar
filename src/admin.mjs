// دستیار مدیر: ورود رمزدار، نشست امضاشده و ابزارهای امن برای کارهای روزمرهٔ داشبورد.
// کلید مدل فقط در محیط سرور خوانده می‌شود و هرگز به مرورگر فرستاده نمی‌شود.

import { createHmac, timingSafeEqual } from 'node:crypto';
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
  return { apiKey: '', baseUrl: '', model: '', provider: '' };
}

/** یک دور گفت‌وگو با مدل؛ ورودی و خروجی سازگار با OpenAI Chat Completions. */
export async function chatWithTools({ messages, tools, config = llmConfig(), fetcher = fetch, timeoutMs = 60000 }) {
  if (!config.apiKey) throw new Error('کلید مدل تنظیم نشده است (ZAI_API_KEY)');
  const response = await fetcher(`${String(config.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
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
