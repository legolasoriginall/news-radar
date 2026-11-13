import test from 'node:test';
import assert from 'node:assert/strict';
import {
  passwordMatches,
  createSession,
  verifySession,
  parseCookies,
  llmConfig,
  runTool,
  runAssistant,
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
