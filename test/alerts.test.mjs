import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectIssues,
  applyIssues,
  unreadCount,
  markAllRead,
  formatAlert,
  sendTelegram,
  telegramConfig,
  maskChatId,
  ALERT_COOLDOWN_MS,
} from '../src/alerts.mjs';

const data = {
  source_health: [
    { id: 'a', name: 'منبع سالم', ok: true, status: 'ok' },
    { id: 'b', name: 'منبع خراب', ok: false, status: 'timeout', error: 'ETIMEDOUT' },
  ],
};

test('فقط منبع خراب و پخش بی‌پاسخ مشکل حساب می‌شوند', () => {
  const issues = collectIssues({
    data,
    channels: [{ id: 'voa', name: 'صدای آمریکا', healthy: '' }, { id: 'iranintl', name: 'ایران اینترنشنال', healthy: 'https://x.m3u8' }],
  });
  assert.deepEqual(issues.map((issue) => issue.id), ['source:b', 'stream:voa']);
  assert.match(issues[0].message, /منبع خراب/);
  assert.match(issues[1].message, /صدای آمریکا/);
});

test('هر مشکل یک هشدار می‌دهد و تکرارش تا پایان cooldown ساکت می‌ماند', () => {
  const now = Date.UTC(2026, 10, 13, 10, 0, 0);
  const issues = collectIssues({ data, channels: [{ id: 'voa', name: 'صدای آمریکا' }] });
  const first = applyIssues({ state: {}, issues, now });
  assert.equal(first.created.length, 2);
  assert.equal(unreadCount(first.state), 2);

  const repeat = applyIssues({ state: first.state, issues, now: now + 5 * 60 * 1000 });
  assert.equal(repeat.created.length, 0);

  const later = applyIssues({ state: first.state, issues, now: now + ALERT_COOLDOWN_MS + 1000 });
  assert.equal(later.created.length, 2);
  assert.equal(later.created.every((alert) => alert.recovery === false), true);
});

test('بعد از بازگشت، هشدار «برطرف شد» ساخته می‌شود', () => {
  const now = Date.UTC(2026, 10, 13, 10, 0, 0);
  const first = applyIssues({ state: {}, issues: collectIssues({ data, channels: [] }), now });
  assert.equal(first.created.length, 1);

  const healthy = applyIssues({
    state: first.state,
    issues: collectIssues({ data: { source_health: [{ id: 'b', name: 'منبع خراب', ok: true }] }, channels: [] }),
    now: now + 60 * 1000,
  });
  assert.equal(healthy.created.length, 1);
  assert.equal(healthy.created[0].recovery, true);
  assert.match(healthy.created[0].message, /به حالت عادی/);
  assert.deepEqual(healthy.state.open, {});
});

test('فهرست هشدارها محدود می‌ماند و خواندن همه علامت‌گذاری می‌شود', () => {
  const now = Date.UTC(2026, 10, 13, 10, 0, 0);
  const result = applyIssues({ state: {}, issues: collectIssues({ data }), now, limit: 1 });
  assert.equal(result.state.alerts.length, 1);
  assert.equal(unreadCount(result.state), 1);
  const read = markAllRead(result.state, now + 1000);
  assert.equal(unreadCount(read), 0);
});

test('متن هشدار فارسی و قابل استفاده در تلگرام است', () => {
  const text = formatAlert({
    kind: 'stream',
    target: 'صدای آمریکا',
    message: 'هیچ مسیر پخشی برای «صدای آمریکا» پاسخ نداد.',
    at: '2026-11-13T06:00:00Z',
    recovery: false,
  });
  assert.match(text, /پخش زنده قطع/);
  assert.match(text, /صدای آمریکا/);
  const recovered = formatAlert({ kind: 'source', message: 'برگشت', at: '2026-11-13T06:00:00Z', recovery: true });
  assert.match(recovered, /بازگشت به حالت عادی/);
});

test('تنظیمات تلگرام از محیط خوانده و شناسه پوشانده می‌شود', () => {
  assert.deepEqual(telegramConfig({}), { token: '', chatId: '', configured: false });
  const config = telegramConfig({ ALERT_TELEGRAM_BOT_TOKEN: ' 123:abc ', ALERT_TELEGRAM_CHAT_ID: '-1001234567890' });
  assert.equal(config.configured, true);
  assert.equal(config.token, '123:abc');
  assert.equal(maskChatId('-1001234567890'), '-1•••90');
  assert.equal(maskChatId(''), '');
});

test('ارسال تلگرام بدون تنظیمات رد نمی‌شود و خطای HTTP را گزارش می‌کند', async () => {
  const skipped = await sendTelegram({ token: '', chatId: '', text: 'x' });
  assert.equal(skipped.skipped, true);

  let called = null;
  const ok = await sendTelegram({
    token: 't',
    chatId: '1',
    text: 'سلام',
    fetcher: async (url, options) => {
      called = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.deepEqual(ok, { ok: true });
  assert.match(called.url, /\/bott\/sendMessage$/);
  assert.equal(called.body.chat_id, '1');
  assert.equal(called.body.text, 'سلام');

  const failed = await sendTelegram({
    token: 't',
    chatId: '1',
    text: 'سلام',
    fetcher: async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Unauthorized');

  const threw = await sendTelegram({
    token: 't',
    chatId: '1',
    text: 'سلام',
    fetcher: async () => { throw new Error('network down'); },
  });
  assert.equal(threw.ok, false);
  assert.match(threw.error, /network down/);
});
