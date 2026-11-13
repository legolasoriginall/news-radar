// تست خواندن پست‌های کانال تلگرام از HTML پیش‌نمایش (بدون شبکه)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTelegramHtml,
  telegramHtmlToText,
  firstUrl,
  telegramChannelTitle,
  normalizeTelegramLink,
  telegramPostTitle,
} from '../src/telegram.mjs';

function message({ id, text, time, media = '', views = '12K', forwarded = '' }) {
  return `
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message js-widget_message" data-post="IranintlTV/${id}">
      ${forwarded ? `<div class="tgme_widget_message_forwarded_from accent_color"><a class="tgme_widget_message_forwarded_from_name" href="https://t.me/x">${forwarded}</a></div>` : ''}
      ${media === 'photo' ? '<a class="tgme_widget_message_photo_wrap"></a>' : ''}
      ${media === 'video' ? '<a class="video_player"></a>' : ''}
      ${media === 'document' ? '<div class="tgme_widget_message_document_wrap"></div>' : ''}
      ${text ? `<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>` : ''}
      <div class="tgme_widget_message_footer">
        <span class="tgme_widget_message_views">${views}</span>
        <a class="tgme_widget_message_date" href="https://t.me/IranintlTV/${id}"><time datetime="${time}">x</time></a>
      </div>
    </div>
  </div>`;
}

const HTML = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Iran International ایران اینترنشنال">
</head><body>
<div class="tgme_channel_info"></div>
<main>
${message({ id: 101, text: 'خبر اول<br/>خط دوم &amp; ادامه', time: '2026-11-13T01:00:00+00:00', views: '57.9K' })}
${message({ id: 102, text: '', time: '2026-11-13T02:00:00+00:00', media: 'video' })}
${message({ id: 103, text: 'خبر سوم https://iranintl.com/202611132161', time: '2026-11-13T03:00:00+00:00', media: 'photo', forwarded: 'ایران اینترنشنال ورزشی' })}
</main></body></html>`;

test('پست‌ها به ترتیب زمان و با متن ساده خوانده می‌شوند', () => {
  const posts = parseTelegramHtml(HTML);
  assert.equal(posts.length, 3);
  assert.deepEqual(posts.map((post) => post.message_id), [101, 102, 103]);
  assert.equal(posts[0].text, 'خبر اول\nخط دوم & ادامه');
  assert.equal(posts[0].views, '57.9K');
  assert.equal(posts[0].url, 'https://t.me/IranintlTV/101');
  assert.equal(posts[0].published, '2026-11-13T01:00:00.000Z');
});

test('پست رسانه‌ای بدون متن حذف نمی‌شود و نوع رسانه را دارد', () => {
  const posts = parseTelegramHtml(HTML);
  assert.equal(posts[1].text, '');
  assert.equal(posts[1].media, 'video');
  assert.equal(posts[2].media, 'photo');
});

test('پیوند داخل متن و نام فوروارد استخراج می‌شود', () => {
  const posts = parseTelegramHtml(HTML);
  assert.equal(posts[2].link, 'https://iranintl.com/202611132161');
  assert.equal(posts[2].forwarded_from, 'ایران اینترنشنال ورزشی');
});

test('محدودیت تعداد و حذف تکراری‌ها کار می‌کند', () => {
  const limited = parseTelegramHtml(HTML, { limit: 2 });
  assert.deepEqual(limited.map((post) => post.message_id), [102, 103]);

  const doubled = parseTelegramHtml(HTML + HTML);
  assert.equal(doubled.length, 3);
});

test('پیوند ایران اینترنشنال یکسان می‌شود و عنوان پست کوتاه می‌ماند', () => {
  assert.equal(normalizeTelegramLink('https://iranintl.com/202611132161'), 'https://www.iranintl.com/202611132161');
  assert.equal(normalizeTelegramLink('http://www.iranintl.com/202611132161'), 'https://www.iranintl.com/202611132161');
  assert.equal(normalizeTelegramLink('https://t.me/IranintlTV/1'), 'https://t.me/IranintlTV/1');
  assert.equal(normalizeTelegramLink(''), '');

  assert.equal(telegramPostTitle({ text: '\n\nخط اول خبر\nخط دوم' }), 'خط اول خبر');
  assert.equal(telegramPostTitle({ text: '' }), 'پست تلگرام');
  const title = telegramPostTitle({ text: 'ا'.repeat(400) });
  assert.ok(title.length <= 180);
  assert.ok(title.endsWith('…'));
});

test('چند کانال همزمان خوانده می‌شوند و خطای یک کانال بقیه را متوقف نمی‌کند', async () => {
  const { fetchTelegramFeeds } = await import('../src/telegram.mjs');
  const channels = [
    { id: 'a', handle: 'chan_a', name: 'کانال الف', label: 'کانال الف (تلگرام)', weight: 0.8 },
    { id: 'b', handle: 'chan_b', name: 'کانال ب', label: 'کانال ب (تلگرام)', weight: 0.7 },
  ];
  const html = '<div class="tgme_widget_message" data-post="chan_a/5">' +
    '<div class="tgme_widget_message_text js-message_text">خبر کانال الف</div>' +
    '<time datetime="2026-11-13T01:00:00+00:00"></time></div>';
  const fetcher = async (url) => {
    if (String(url).includes('chan_b')) return { ok: false, status: 500, text: async () => '' };
    return { ok: true, status: 200, text: async () => html };
  };
  const result = await fetchTelegramFeeds({ channels, fetcher });
  assert.equal(result.feeds.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].channel, 'chan_b');
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].channel_name, 'کانال الف');
  assert.equal(result.posts[0].source.id, 'a');
  assert.equal(result.posts[0].source.lang, 'fa');
});

test('فهرست کانال‌ها شناسه و نام کاربری یکتا دارد', async () => {
  const { TELEGRAM_CHANNELS } = await import('../src/telegram.mjs');
  assert.ok(TELEGRAM_CHANNELS.length >= 5);
  assert.equal(new Set(TELEGRAM_CHANNELS.map((channel) => channel.id)).size, TELEGRAM_CHANNELS.length);
  assert.equal(new Set(TELEGRAM_CHANNELS.map((channel) => channel.handle)).size, TELEGRAM_CHANNELS.length);
  for (const channel of TELEGRAM_CHANNELS) {
    assert.match(channel.handle, /^[A-Za-z0-9_]{4,32}$/);
    assert.ok(channel.name && channel.label);
  }
});

test('پست تلگرام با متن بلند به قصهٔ همان رویداد در خبرها وصل می‌شود', async () => {
  const { clusterArticles } = await import('../src/analyze.mjs');
  const post = {
    uid: 'tg-1',
    source_id: 'iranintl_tv',
    source_name: 'ایران اینترنشنال (تلگرام)',
    lang: 'fa',
    title: 'ترامپ گفت جنگ ایران می‌تواند پایان یابد',
    title_fa: '',
    cluster_title: 'ترامپ گفت جنگ ایران می‌تواند پایان یابد',
    link: 'https://t.me/IranintlTV/1',
    published: '2026-11-13T01:00:00.000Z',
  };
  const site = {
    uid: 'site-1',
    source_id: 'khabaronline',
    source_name: 'خبرآنلاین',
    lang: 'fa',
    title: 'ترامپ: جنگ ایران پایان می‌یابد',
    title_fa: '',
    link: 'https://www.khabaronline.ir/1',
    published: '2026-11-13T01:05:00.000Z',
  };
  const clusters = clusterArticles([post, site]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].members.length, 2);
});

test('تبدیل HTML، موجودیت‌ها و عنوان کانال', () => {
  assert.equal(telegramHtmlToText('a &lt;b&gt; c &#171;د&#187;'), 'a <b> c «د»');
  assert.equal(firstUrl('متن https://iranintl.com/202611132161.'), 'https://iranintl.com/202611132161');
  assert.equal(telegramChannelTitle(HTML), 'Iran International ایران اینترنشنال');
});
