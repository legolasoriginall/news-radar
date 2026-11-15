// تست خواندن وب دستیار: آدرس‌های داخلی و تغییرمسیر به شبکهٔ خصوصی مسدود می‌شوند
// اجرا: npm test  (بدون شبکه؛ فچر ساختگی تزریق می‌شود)
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicUrl, readPage, htmlToText, parseNewsSearch } from '../src/web.mjs';

function fakeResponse({ url, body, type = 'text/html; charset=utf-8', ok = true, status = 200 }) {
  return {
    ok,
    status,
    url,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
    text: async () => body,
  };
}

test('آدرس‌های داخلی و خصوصی عمومی نیستند', () => {
  for (const url of [
    'http://127.0.0.1/admin',
    'http://localhost:3000/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.20.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.equal(isPublicUrl(url), false, url);
  }
  assert.equal(isPublicUrl('https://example.com/news'), true);
});

test('تغییرمسیر به آدرس غیرعمومی مسدود می‌شود', async () => {
  const result = await readPage({
    url: 'https://example.com/rss',
    fetcher: async () => fakeResponse({ url: 'http://127.0.0.1:6379/', body: 'secret' }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /تغییرمسیر/);
});

test('صفحهٔ عمومی خوانده و متن آن برگردانده می‌شود', async () => {
  const result = await readPage({
    url: 'https://example.com/news',
    fetcher: async () => fakeResponse({
      url: 'https://example.com/news',
      body: '<html><head><title>خبر مهم</title><script>alert(1)</script></head><body><p>متن اصلی</p></body></html>',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.title, 'خبر مهم');
  assert.match(result.text, /متن اصلی/);
  assert.doesNotMatch(result.text, /alert/);
});

test('تبدیل HTML به متن، اسکریپت و استایل را حذف می‌کند', () => {
  const text = htmlToText('<style>.a{color:red}</style><p>سلام<br>دنیا</p><script>x()</script>');
  assert.equal(text, 'سلام\nدنیا');
});

test('خوراک جستجوی گوگل‌نیوز به نتیجه‌های خوانا تبدیل می‌شود', () => {
  const xml = `<rss><channel>
    <item><title>عنوان یک</title><link>https://example.com/1</link><pubDate>Sun, 15 Nov 2026 08:00:00 GMT</pubDate><source>منبع</source></item>
    <item><title>عنوان دو</title><link>https://example.com/2</link></item>
  </channel></rss>`;
  const items = parseNewsSearch(xml, { limit: 5 });
  assert.equal(items.length, 2);
  assert.equal(items[0].link, 'https://example.com/1');
  assert.equal(items[0].published, '2026-11-15T08:00:00.000Z');
  assert.equal(items[1].published, null);
});
