import test from 'node:test';
import assert from 'node:assert/strict';
import {
  passwordMatches,
  hashPassword,
  verifyPassword,
  validateNewPassword,
  createSession,
  verifySession,
  parseCookies,
  llmConfig,
  runTool,
  runAssistant,
  intentOf,
  queryOf,
  describeToolResult,
  detectOllama,
} from '../src/admin.mjs';

test('رمز مدیر فقط با مقدار دقیق پذیرفته می‌شود', () => {
  assert.equal(passwordMatches('secret-123', 'secret-123'), true);
  assert.equal(passwordMatches('secret-124', 'secret-123'), false);
  assert.equal(passwordMatches('secret', 'secret-123'), false);
  assert.equal(passwordMatches('anything', ''), false);
});

test('نشست امضاشده فقط تا زمان انقضا معتبر است', () => {
  const secret = 'admin-secret';
  const now = 1_700_000_000_000;
  const token = createSession(secret, now);

  assert.equal(verifySession(secret, token, now + 1000), true);
  assert.equal(verifySession(secret, token, now + 13 * 60 * 60 * 1000), false);
  assert.equal(verifySession('other-secret', token, now + 1000), false);
  assert.equal(verifySession(secret, token.replace(/\d$/, '0'), now + 1000), false);
  assert.equal(verifySession(secret, 'broken', now), false);
});

test('رمز به‌صورت هش ذخیره و فقط با مقدار درست تأیید می‌شود', () => {
  const record = hashPassword('A654a4546@');
  assert.equal(record.hash.includes('A654a4546@'), false);
  assert.equal(verifyPassword('A654a4546@', record), true);
  assert.equal(verifyPassword('A654a4546', record), false);
  assert.equal(verifyPassword('anything', null), false);
  const other = hashPassword('A654a4546@');
  assert.notEqual(other.salt, record.salt);
  assert.notEqual(other.hash, record.hash);
});

test('رمز تازه باید بلند و ترکیبی باشد', () => {
  assert.equal(validateNewPassword('short1'), 'رمز تازه باید دست‌کم ۸ نویسه باشد');
  assert.equal(validateNewPassword('12345678'), 'رمز تازه باید حداقل یک حرف داشته باشد');
  assert.equal(validateNewPassword('abcdefgh'), 'رمز تازه باید حداقل یک رقم یا نماد داشته باشد');
  assert.equal(validateNewPassword('abcdefg1'), '');
});

test('کوکی‌های درخواست به نقشه تبدیل می‌شوند', () => {
  assert.deepEqual(parseCookies('radar_admin=abc.def; theme=dark'), { radar_admin: 'abc.def', theme: 'dark' });
  assert.deepEqual(parseCookies(''), {});
});

test('پیکربندی مدل از محیط خوانده می‌شود و بدون کلید خالی است', () => {
  assert.equal(llmConfig({}).apiKey, '');
  const zai = llmConfig({ ZAI_API_KEY: 'k' });
  assert.equal(zai.provider, 'z.ai');
  assert.match(zai.baseUrl, /z\.ai/);
  const openai = llmConfig({ OPENAI_API_KEY: 'k' });
  assert.equal(openai.provider, 'openai');
  assert.match(openai.baseUrl, /openai\.com/);
});

test('بدون کلید، مدل محلی پیش‌فرض است و کلید لازم ندارد', () => {
  const config = llmConfig({});
  assert.equal(config.provider, 'ollama');
  assert.equal(config.apiKey, '');
  assert.match(config.baseUrl, /127\.0\.0\.1:11434/);
});

test('تشخیص Ollama ناموفق بودن را بی‌خطا گزارش می‌کند', async () => {
  const down = await detectOllama({ fetcher: async () => { throw new Error('refused'); } });
  assert.deepEqual(down, { available: false, models: [] });
  const up = await detectOllama({
    fetcher: async () => ({ ok: true, json: async () => ({ data: [{ id: 'llama3.2' }, { id: 'qwen2.5' }] }) }),
  });
  assert.deepEqual(up, { available: true, models: ['llama3.2', 'qwen2.5'] });
});

test('حالت بدون مدل، جملهٔ مدیر را به دستور درست تبدیل می‌کند', () => {
  assert.equal(intentOf('وضعیت سایت چطوره؟'), 'site_status');
  assert.equal(intentOf('سلامت پخش شبکه‌ها را بررسی کن'), 'stream_health');
  assert.equal(intentOf('یک به‌روزرسانی انجام بده'), 'refresh_site');
  assert.equal(intentOf('سلام'), '');
  assert.equal(intentOf('گزارش منابع را بده'), 'source_report');
  assert.equal(intentOf('موضوع‌های داغ چیست؟'), 'topic_report');
  assert.equal(intentOf('خبرهای دربارهٔ اقتصاد'), 'news_search');
  assert.equal(queryOf('خبرهای دربارهٔ اقتصاد را نشان بده'), 'اقتصاد');
});

const sampleData = {
  generated_at: '2026-11-13T06:00:00Z',
  source_health: [
    { id: 'a', name: 'منبع سالم', ok: true, status: 'ok' },
    { id: 'b', name: 'منبع خراب', ok: false, status: 'error', error: 'timeout' },
  ],
  topics: [{ name: 'بین‌الملل', count: 674, percent: 48.1, trend: 'up' }],
  articles: [
    { title: 'Iran talks', title_fa: 'گفت‌وگو با ایران', source_name: 'Reuters', published: '2026-11-13T05:00:00Z' },
    { title: 'Other news', source_name: 'AP', published: '2026-11-13T04:00:00Z' },
  ],
};

test('ابزار گزارش منابع فقط منابع خراب را برمی‌گرداند', async () => {
  const result = await runTool('source_report', {}, { getData: async () => sampleData });
  assert.equal(result.total, 2);
  assert.deepEqual(result.broken.map((item) => item.name), ['منبع خراب']);
  assert.match(describeToolResult('source_report', result), /منبع خراب: timeout/);
  const healthy = await runTool('source_report', {}, { getData: async () => ({ source_health: [{ name: 'x', ok: true }] }) });
  assert.match(describeToolResult('source_report', healthy), /سالم/);
});

test('ابزار جستجوی خبر فارسی و انگلیسی را می‌فهمد', async () => {
  const fa = await runTool('news_search', { query: 'ایران' }, { getData: async () => sampleData });
  assert.equal(fa.ok, true);
  assert.equal(fa.items.length, 1);
  assert.equal(fa.items[0].title, 'گفت‌وگو با ایران');
  const en = await runTool('news_search', { query: 'AP' }, { getData: async () => sampleData });
  assert.equal(en.items.length, 1);
  const empty = await runTool('news_search', { query: 'هیچ‌چیز' }, { getData: async () => sampleData });
  assert.match(describeToolResult('news_search', empty), /پیدا نشد/);
  const missing = await runTool('news_search', { query: '' }, { getData: async () => sampleData });
  assert.equal(missing.ok, false);
});

test('ابزار موضوع‌های داغ خلاصهٔ فارسی می‌دهد', async () => {
  const result = await runTool('topic_report', {}, { getData: async () => sampleData });
  assert.equal(result.topics.length, 1);
  const text = describeToolResult('topic_report', result);
  assert.match(text, /بین‌الملل/);
  assert.match(text, /صعودی/);
});

test('خلاصهٔ فارسی نتیجهٔ ابزار ساخته می‌شود', () => {
  const text = describeToolResult('site_status', { ok: true, total: 1400, stories: 1335, multi_source: 37, telegram_posts: 87, markets: 8, generated_at: '2026-11-13T05:00:00Z' });
  assert.match(text, /خبرها/);
  assert.match(text, /۱٬۴۰۰|۱۴۰۰/);
  const failed = describeToolResult('refresh_site', { ok: false, error: 'boom' });
  assert.match(failed, /boom/);
});

test('ابزار وضعیت سایت داده را برمی‌گرداند', async () => {
  const result = await runTool('site_status', {}, {
    getStatus: async () => ({ total: 1400, stories: 1335 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 1400);
});

test('ابزار سلامت پخش اولین مسیر سالم را انتخاب می‌کند', async () => {
  const channel = { id: 'demo', name: 'دمو', fallbacks: ['https://dead.example/a.m3u8', 'https://alive.example/b.m3u8'] };
  const result = await runTool('stream_health', {}, {
    channels: [channel],
    probe: async (url) => url.includes('alive'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.channels[0].healthy, 'https://alive.example/b.m3u8');
  assert.equal(result.channels[0].attempted, 2);
});

test('ابزار ناشناخته خطا می‌دهد', async () => {
  const result = await runTool('do_everything', {}, {});
  assert.equal(result.ok, false);
});

test('دستیار ابزار را صدا می‌زند و سپس پاسخ نهایی می‌دهد', async () => {
  const calls = [];
  const replies = [
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'site_status', arguments: '{}' } }] },
    { role: 'assistant', content: 'سایت تازه است: ۱۴۰۰ خبر.' },
  ];
  const result = await runAssistant({
    messages: [{ role: 'user', content: 'وضعیت؟' }],
    chat: async () => replies.shift(),
    execute: async (name) => {
      calls.push(name);
      return { ok: true, total: 1400 };
    },
  });

  assert.deepEqual(calls, ['site_status']);
  assert.deepEqual(result.used, ['site_status']);
  assert.match(result.reply, /۱۴۰۰/);
});
