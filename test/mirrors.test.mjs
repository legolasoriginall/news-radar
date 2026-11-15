import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alternateFeedUrls,
  feedMirrors,
  isFeedXml,
  fetchFeedWithMirrors,
  waybackMirror,
} from '../src/mirrors.mjs';

const FEED = '<?xml version="1.0"?><rss><channel><item><title>خبر آزمایشی</title></item></channel></rss>';
const HTML = '<!doctype html><html><body>صفحهٔ خطا</body></html>';

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function fakeFetcher(routes = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return response('', { ok: false, status: 404 });
    return typeof route === 'function' ? route(url) : route;
  };
  fetcher.calls = calls;
  return fetcher;
}

test('مسیرهای جایگزین همان دامنه ساخته می‌شوند', () => {
  const urls = alternateFeedUrls('https://example.com/rss');
  assert.ok(urls.includes('http://example.com/rss'));
  assert.ok(urls.includes('https://example.com/rss/'));
  assert.ok(urls.includes('https://example.com/rss.xml'));
  assert.equal(alternateFeedUrls('not a url').length, 0);
  assert.equal(alternateFeedUrls('ftp://example.com/rss').length, 0);
});

test('مسیر ذخیره‌شده اولویت دارد و تکراری‌ها حذف می‌شوند', () => {
  const mirrors = feedMirrors('https://example.com/rss', 'https://example.com/rss.xml');
  assert.equal(mirrors[0], 'https://example.com/rss.xml');
  assert.equal(new Set(mirrors).size, mirrors.length);
  assert.equal(mirrors.includes('https://example.com/rss'), false);
});

test('اعتبارسنجی خوراک، HTML را رد می‌کند', () => {
  assert.equal(isFeedXml(FEED), true);
  assert.equal(isFeedXml('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true);
  assert.equal(isFeedXml(HTML), false);
});

test('وقتی مسیر اصلی خطا می‌دهد، آینهٔ بعدی خوانده می‌شود', async () => {
  const url = 'https://example.com/rss';
  const mirrors = alternateFeedUrls(url);
  const fetcher = fakeFetcher({
    [url]: response('', { ok: false, status: 503 }),
    [mirrors[0]]: response(FEED),
  });
  const result = await fetchFeedWithMirrors({ url, fetcher, tryWayback: false });
  assert.equal(result.ok, true);
  assert.equal(result.via, mirrors[0]);
  // مسیر اصلی در خود پایپ‌لاین (با دو تلاش) امتحان شده و این تابع فقط آینه‌ها را می‌خواند.
  assert.equal(fetcher.calls.includes(url), false);
  assert.equal(fetcher.calls[0], mirrors[0]);
});

test('پاسخ HTML به‌عنوان آینه پذیرفته نمی‌شود', async () => {
  const url = 'https://example.com/feed';
  const mirrors = alternateFeedUrls(url);
  const fetcher = fakeFetcher({
    [url]: response('', { ok: false, status: 404 }),
    [mirrors[0]]: response(HTML),
    [mirrors[1]]: response(FEED),
  });
  const result = await fetchFeedWithMirrors({ url, fetcher, tryWayback: false });
  assert.equal(result.ok, true);
  assert.equal(result.via, mirrors[1]);
  assert.ok(result.attempts.some((item) => item.url === mirrors[0] && /معتبر نبود/.test(item.error)));
});

test('آینهٔ ذخیره‌شده زودتر از بقیه امتحان می‌شود', async () => {
  const url = 'https://example.com/rss';
  const cached = 'https://example.com/old-feed';
  const fetcher = fakeFetcher({ [cached]: response(FEED) });
  const result = await fetchFeedWithMirrors({ url, cached, fetcher, tryWayback: false });
  assert.equal(result.ok, true);
  assert.equal(result.via, cached);
  assert.deepEqual(fetcher.calls, [cached]);
});

test('اگر همهٔ مسیرها بسته باشند، اسنپ‌شات آرشیو خوانده می‌شود', async () => {
  const url = 'https://example.com/rss';
  const snapshot = 'https://web.archive.org/web/20261109100714id_/https://example.com/rss';
  const fetcher = fakeFetcher({
    [url]: response('', { ok: false, status: 500 }),
    'https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Frss': response(
      JSON.stringify({
        archived_snapshots: { closest: { available: true, status: '200', timestamp: '20261109100714' } },
      })
    ),
    [snapshot]: response(FEED),
  });
  // URL.href ممکن است اسلش پایانی اضافه کند؛ هر دو حالت را پوشش می‌دهیم.
  const result = await fetchFeedWithMirrors({ url, fetcher });
  assert.equal(result.ok, true);
  assert.match(result.via, /^https:\/\/web\.archive\.org\/web\/20261109100714id_\//);
});

test('بدون اسنپ‌شات، آرشیو کنار گذاشته می‌شود و خطا گزارش می‌شود', async () => {
  const url = 'https://example.com/rss';
  const fetcher = fakeFetcher({
    'https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Frss': response(
      JSON.stringify({ archived_snapshots: {} })
    ),
  });
  const result = await fetchFeedWithMirrors({ url, fetcher });
  assert.equal(result.ok, false);
  assert.match(result.error, /پاسخ نداد|امتحان شد/);
});

test('نشانی آرشیو فقط برای اسنپ‌شات سالم ساخته می‌شود', async () => {
  const good = fakeFetcher({
    'https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Ffeed': response(
      JSON.stringify({ archived_snapshots: { closest: { available: true, status: '200', timestamp: '20260101000000' } } })
    ),
  });
  assert.equal(
    await waybackMirror('https://example.com/feed', { fetcher: good }),
    'https://web.archive.org/web/20260101000000id_/https://example.com/feed'
  );
  const bad = fakeFetcher({
    'https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Ffeed': response(
      JSON.stringify({ archived_snapshots: { closest: { available: true, status: '404', timestamp: '20260101000000' } } })
    ),
  });
  assert.equal(await waybackMirror('https://example.com/feed', { fetcher: bad }), '');
});
