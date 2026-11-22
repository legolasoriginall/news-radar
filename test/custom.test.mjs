import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceInput, parseChannelInput, parseLiveInput, parseChannelHandle, looksLikeFeed, feedItemCount } from '../src/custom.mjs';
import { SOURCES, addSource, removeSource } from '../src/sources.mjs';
import { TELEGRAM_CHANNELS, addTelegramChannel, removeTelegramChannel } from '../src/telegram.mjs';

test('ورودی منبع خبری پاک‌سازی و شناسه‌سازی می‌شود', () => {
  const result = parseSourceInput({ name: '  شرق  ', url: 'https://www.sharghdaily.com/rss', lang: 'FA', origin: 'iran', weight: 1.4 });
  assert.equal(result.ok, true);
  assert.equal(result.source.id, 'custom_sharghdaily_com');
  assert.equal(result.source.name, 'شرق');
  assert.equal(result.source.lang, 'fa');
  assert.equal(result.source.origin, 'iran');
  assert.equal(result.source.weight, 0.9);
  assert.equal(result.source.custom, true);
});

test('نام خالی از دامنه ساخته می‌شود و زبان/خاستگاه ناشناخته پیش‌فرض می‌گیرد', () => {
  const result = parseSourceInput({ url: 'https://feeds.example.com/news.xml', lang: 'xx', origin: 'moon' });
  assert.equal(result.ok, true);
  assert.equal(result.source.name, 'feeds.example.com');
  assert.equal(result.source.lang, 'fa');
  assert.equal(result.source.origin, 'foreign');
  assert.equal(result.source.weight, 0.7);
});

test('آدرس نامعتبر یا غیر http رد می‌شود', () => {
  assert.equal(parseSourceInput({ url: '' }).ok, false);
  assert.equal(parseSourceInput({ url: 'not a url' }).ok, false);
  assert.equal(parseSourceInput({ url: 'ftp://example.com/rss' }).ok, false);
});

test('نام کانال از @ و لینک t.me بیرون کشیده می‌شود', () => {
  assert.equal(parseChannelHandle('@ManotoTV'), 'ManotoTV');
  assert.equal(parseChannelHandle('https://t.me/s/manototv'), 'manototv');
  assert.equal(parseChannelHandle('t.me/manototv/123'), 'manototv');
  assert.equal(parseChannelHandle('  '), '');
});

test('ورودی کانال تلگرام رکورد درست می‌سازد', () => {
  const result = parseChannelInput({ handle: 'https://t.me/s/ShargDaily', name: 'روزنامهٔ شرق' });
  assert.equal(result.ok, true);
  assert.equal(result.channel.handle, 'ShargDaily');
  assert.equal(result.channel.id, 'custom_tg_shargdaily');
  assert.equal(result.channel.label, 'روزنامهٔ شرق (تلگرام)');
  const defaultName = parseChannelInput({ handle: '@example_channel' });
  assert.equal(defaultName.channel.name, '@example_channel');
});

test('نام کانال کوتاه یا نامعتبر رد می‌شود', () => {
  assert.equal(parseChannelInput({ handle: '' }).ok, false);
  assert.equal(parseChannelInput({ handle: 'abc' }).ok, false);
  assert.equal(parseChannelInput({ handle: '9badname' }).ok, false);
  assert.equal(parseChannelInput({ handle: 'bad name' }).ok, false);
});

test('تشخیص خوراک و شمارش آیتم‌ها', () => {
  assert.equal(looksLikeFeed('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'), true);
  assert.equal(looksLikeFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true);
  assert.equal(looksLikeFeed('<html><body>سلام</body></html>'), false);
  assert.equal(feedItemCount('<rss><item>a</item><item>b</item></rss>'), 2);
  assert.equal(feedItemCount('<feed><entry>a</entry></feed>'), 1);
  assert.equal(feedItemCount('<html></html>'), 0);
});

test('افزودن و حذف منبع اختصاصی فهرست پیش‌فرض را دست نمی‌زند', () => {
  const base = SOURCES.length;
  const added = addSource(parseSourceInput({ name: 'آزمایشی', url: 'https://test.example.com/feed' }).source);
  assert.equal(SOURCES.length, base + 1);
  assert.equal(removeSource(added.id), true);
  assert.equal(SOURCES.length, base);
  assert.equal(removeSource('bbc_persian'), false, 'منبع پیش‌فرض حذف نمی‌شود');
});

test('افزودن و حذف کانال اختصاصی کار می‌کند و کانال پیش‌فرض حذف نمی‌شود', () => {
  const base = TELEGRAM_CHANNELS.length;
  const added = addTelegramChannel(parseChannelInput({ handle: '@testchannel', name: 'کانال آزمایشی' }).channel);
  assert.equal(TELEGRAM_CHANNELS.length, base + 1);
  assert.equal(removeTelegramChannel(added.id), true);
  assert.equal(TELEGRAM_CHANNELS.length, base);
  assert.equal(removeTelegramChannel(TELEGRAM_CHANNELS[0].id), false);
});

test('ورودی کانال پخش زنده اعتبارسنجی می‌شود و جایگزین‌ها تصفیه می‌شوند', () => {
  const result = parseLiveInput({
    name: ' شبکهٔ خدمت ',
    url: 'https://example.org/live/stream.m3u8',
    fallbacks: ['https://example.org/live/backup.m3u8', 'https://example.org/live/backup.m3u8'],
    watch: 'https://example.org/live',
  });
  assert.equal(result.ok, true);
  assert.equal(result.channel.name, 'شبکهٔ خدمت');
  assert.equal(result.channel.url, 'https://example.org/live/stream.m3u8');
  assert.deepEqual(result.channel.fallbacks, ['https://example.org/live/backup.m3u8']);
  assert.equal(result.channel.watch, 'https://example.org/live');
});

test('آدرس غیر HLS یا فیلد نامعتبر کانال زنده رد می‌شود', () => {
  assert.equal(parseLiveInput({ name: 'x', url: 'https://example.org/live/stream.mp4' }).ok, false);
  assert.equal(parseLiveInput({ name: 'x', url: 'ftp://example.org/stream.m3u8' }).ok, false);
  assert.equal(parseLiveInput({ name: '', url: 'https://example.org/stream.m3u8' }).ok, false);
  assert.equal(parseLiveInput({ name: 'x', url: 'https://example.org/stream.m3u8', fallbacks: ['https://example.org/bad.mp4'] }).ok, false);
  assert.equal(parseLiveInput({ name: 'x', url: 'https://example.org/stream.m3u8', watch: 'not-a-url' }).ok, false);
  const many = parseLiveInput({ name: 'x', url: 'https://example.org/stream.m3u8', fallbacks: Array.from({ length: 6 }, (_, i) => 'https://example.org/f' + i + '.m3u8') });
  assert.equal(many.ok, false);
});
