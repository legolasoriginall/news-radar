// تست شکستن دادهٔ کامل به فایل‌های سبک سایت: فهرست کارت‌ها، جزئیات هر خبر و قطعه‌های آرشیو
// اجرا: npm test  (بدون شبکه و بدون data.json واقعی)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFeed, writeSite, articleKey } from '../scripts/build-feed.mjs';

function sampleData(count) {
  const articles = Array.from({ length: count }, (unused, index) => ({
    uid: 'uid' + (index + 1),
    source_name: 'منبع ' + (index + 1),
    lang: 'fa',
    title: 'عنوان ' + (index + 1),
    title_fa: 'عنوان فارسی ' + (index + 1),
    link: 'https://example.com/news/' + (index + 1),
    published: new Date(Date.UTC(2026, 10, 20, 12 - index)).toISOString(),
    is_new: index === 0,
    source_count: 2,
    summary: 'خلاصهٔ اصلی ' + (index + 1),
    summary_fa: 'خلاصهٔ فارسی ' + (index + 1),
    sources: ['منبع الف', 'منبع ب'],
    telegram: { post_url: 'https://t.me/c/' + index, channel_name: 'کانال' },
    keywords: ['واژه'],
    importance: 0.5 + index,
    topics: [{ name: 'موضوع ' + index, count: 4 }],
    translation: { is_translation: true, provider: 'MyMemory' },
  }));
  return {
    generated_at: '2026-11-20T12:00:00.000Z',
    next_update_at: '2026-11-20T12:05:00.000Z',
    update_interval_minutes: 5,
    stats: { total: count, stories: count, multi_source_stories: 1, fresh_24h: count, sources_ok: 2, sources_total: 3 },
    settings: { silent_hours: 24 },
    markets: { items: [{ label: 'دلار', value: 60000, unit: 'تومان', change_percent: 1.2 }] },
    topics: [{ name: 'موضوع', count: 3 }],
    translations: { provider: 'MyMemory' },
    analysis: { headline: 'تیتر تحلیل', lines: ['خط یک', 'خط دو'], findings: [] },
    keywords: [{ word: 'ایران', count: 10, percent: 5, size_percent: 100 }],
    keyword_counts: { 'ایران': 10 },
    hourly: { buckets: [{ hour: '2026-11-20T10:00:00.000Z', count: 3, percent: 1, height_percent: 10 }] },
    source_health: [{ id: 's1', name: 'منبع', ok: true, password: 'نباید منتشر شود' }],
    summary_lines: ['خط اول'],
    stories: Array.from({ length: 20 }, (unused, index) => ({
      title: 'قصه ' + index,
      title_original: 'Story ' + index,
      url: 'https://example.com/story/' + index,
      published: '2026-11-20T10:00:00.000Z',
      sentiment: -0.4,
      primary_source: 'منبع',
      source_count: 2,
      sources: [{ id: 's1', name: 'منبع یک', url: 'https://example.com/1' }],
      importance: 3,
    })),
    telegram: { posts: [{ id: 1, text: 'پست' }], channels: [{ id: 'ch1', name: 'کانال' }] },
    articles,
  };
}

test('فهرست کارت‌ها سبک است و خلاصه/منابع/تلگرام در آن نیست', () => {
  const built = buildFeed(sampleData(5), { head: 2 });
  assert.equal(built.feed.articles.length, 2);
  const card = built.feed.articles[0];
  assert.equal(card.uid, 'uid1');
  assert.equal(card.summary, undefined);
  assert.equal(card.summary_fa, undefined);
  assert.equal(card.sources, undefined);
  assert.equal(card.telegram, undefined);
  assert.equal(card.keywords, undefined);
  assert.deepEqual(card.topics, [{ name: 'موضوع 0' }]);
  assert.deepEqual(card.translation, { is_translation: true });
  // بخش «تصویر کلی امروز» از همین فهرست خوانده می‌شود، پس تحلیل و کلیدواژه‌ها می‌آیند.
  assert.equal(built.feed.analysis.headline, 'تیتر تحلیل');
  assert.equal(built.feed.keywords[0].word, 'ایران');
  assert.equal(built.feed.hourly.buckets[0].count, 3);
  // ولی داده‌های سنگین و تکراری به فهرست نمی‌رسند.
  assert.equal(built.feed.keyword_counts, undefined);
  // سلامت منابع فقط در health.json می‌آید.
  assert.equal(built.feed.source_health, undefined);
});

test('جزئیات هر خبر در فایل جدا نوشته می‌شود', () => {
  const data = sampleData(3);
  const built = buildFeed(data);
  const key = articleKey(data.articles[0]);
  const detail = built.details.get(encodeURIComponent(key));
  assert.ok(detail, 'فایل جزئیات باید وجود داشته باشد');
  assert.equal(detail.summary_fa, 'خلاصهٔ فارسی 1');
  assert.deepEqual(detail.sources, ['منبع الف', 'منبع ب']);
  assert.equal(detail.telegram.post_url, 'https://t.me/c/0');
  assert.equal(detail.importance, 0.5);
  assert.equal(built.details.size, 3);
});

test('آرشیو به قطعه‌های مشخص شکسته می‌شود و ترتیب تازه‌ترین اول است', () => {
  const data = sampleData(7);
  data.articles.reverse();
  const built = buildFeed(data, { head: 3, chunkSize: 2 });
  assert.equal(built.counts.articles, 7);
  assert.equal(built.chunks.length, 2);
  assert.equal(built.chunks[0].articles.length, 2);
  assert.equal(built.chunks[1].articles.length, 2);
  assert.equal(built.feed.articles[0].uid, 'uid1');
  assert.equal(built.chunks[0].articles[0].uid, 'uid4');
});

test('قصه‌ها محدود و سبک‌اند و فیلد حساس سلامت منابع منتشر نمی‌شود', () => {
  const built = buildFeed(sampleData(4));
  assert.equal(built.feed.stories.length, 12);
  assert.equal(built.feed.stories[0].title_original, undefined);
  assert.deepEqual(built.feed.stories[0].sources, [{ name: 'منبع یک' }]);
  assert.equal(built.health.source_health[0].password, undefined);
  assert.equal(built.summary.stats.total, 4);
  // فهرست سبک منابع برای فیلتر فید؛ فیلد حساس سلامت منابع با آن نمی‌آید.
  assert.deepEqual(built.feed.sources[0], { id: 's1', name: 'منبع' });
  assert.equal(built.feed.telegram.deferred, true);
  assert.equal(built.feed.telegram.posts.length, 0);
  assert.equal(built.telegram.telegram.posts.length, 1);
});

test('نوشتن روی دیسک فایل‌های مورد انتظار و نه data.json را می‌سازد', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-radar-feed-'));
  try {
    const built = writeSite(sampleData(5), outDir, { head: 2, chunkSize: 2 });
    const names = fs.readdirSync(outDir).sort();
    assert.deepEqual(names, ['detail', 'feed-more-1.json', 'feed-more-2.json', 'feed.json', 'health.json', 'summary.json', 'telegram.json']);
    assert.equal(fs.existsSync(path.join(outDir, 'data.json')), false);
    const feed = JSON.parse(fs.readFileSync(path.join(outDir, 'feed.json'), 'utf8'));
    assert.equal(feed.articles.length, 2);
    const detail = JSON.parse(fs.readFileSync(path.join(outDir, 'detail', 'uid1.json'), 'utf8'));
    assert.equal(detail.detail.summary_fa, 'خلاصهٔ فارسی 1');
    assert.equal(built.counts.details, 5);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
