#!/usr/bin/env node
/* ساخت فایل‌های سبک سایت از data.json.
 *
 * صفحهٔ اصلی دیگر data.json چندمگابایتی را نمی‌خواند؛ به‌جای آن:
 * - feed.json: فهرست سبک کارت‌ها (بدون خلاصه، منابع و تلگرام) + ۱۲ قصهٔ اول
 * - detail/<uid>.json: جزئیات هر خبر، فقط وقتی کاربر بخواهد خوانده می‌شود
 * - feed-more-<n>.json: قطعه‌های آرشیو برای «نمایش بیشتر»
 * - telegram.json / health.json / summary.json: فایل‌های سبک صفحه‌های دیگر
 *
 * اجرا: node scripts/build-feed.mjs --data data.json --out _site
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const HEAD_COUNT = 200;
export const CHUNK_SIZE = 500;
export const STORY_HEAD = 12;

// فیلدهایی که کارت فید واقعاً می‌خواند؛ بقیه در فایل جزئیات می‌آیند.
const CARD_KEYS = ['uid', 'source_name', 'lang', 'title', 'title_fa', 'link', 'published', 'is_new', 'source_count'];
const DETAIL_KEYS = ['summary', 'summary_fa', 'sources', 'telegram', 'importance', 'importance_percent',
  'coverage_percent', 'cluster_size', 'sentiment', 'sentiment_label', 'keywords', 'age_hours',
  'translation', 'title_original'];
const STORY_KEYS = ['title', 'title_fa', 'url', 'telegram', 'published', 'sentiment',
  'primary_source', 'source_count', 'members_count', 'importance'];
const STORY_MEMBER_KEYS = ['uid', 'source_name', 'title', 'url', 'published', 'lang'];
// source_health فقط در سلامت منابع پنل مدیر و صفحهٔ وضعیت لازم است و در فید نمی‌آید.
// analysis/keywords/hourly پشتوانهٔ بخش «تصویر کلی امروز» است (حدود ۹ کیلوبایت).
const FEED_KEYS = ['generated_at', 'next_update_at', 'update_interval_minutes', 'stats', 'markets',
  'topics', 'analysis', 'keywords', 'hourly', 'translations', 'settings'];
const HEALTH_KEYS = ['id', 'name', 'lang', 'ok', 'elapsed_ms', 'success_percent', 'count', 'error', 'via', 'mirror'];
const STAT_KEYS = ['total', 'stories', 'multi_source_stories', 'fresh_24h', 'sources_ok', 'sources_total'];

const byDate = (a, b) => new Date(b.published) - new Date(a.published);

function pick(source, keys) {
  const out = {};
  keys.forEach((key) => {
    if (source && source[key] !== undefined && source[key] !== null) out[key] = source[key];
  });
  return out;
}

export function articleKey(article) {
  return String(article.uid || article.link || article.title || '');
}

function cardOf(article) {
  const card = pick(article, CARD_KEYS);
  if (Array.isArray(article.topics)) {
    card.topics = article.topics
      .slice(0, 3)
      .map((topic) => (topic && typeof topic === 'object' && topic.name ? { name: topic.name } : topic));
  }
  if (article.translation && article.translation.is_translation) card.translation = { is_translation: true };
  return card;
}

function detailOf(article) {
  return pick(article, DETAIL_KEYS);
}

function storyOf(story) {
  const out = pick(story, STORY_KEYS);
  const sources = Array.isArray(story.sources) ? story.sources.filter(Boolean) : [];
  out.sources = sources.map((source) => pick(source, ['id', 'name', 'url']));
  // هر خبر عضو قصه با پیوند و زمان انتشار؛ دادهٔ قدیمی بدون members
  // با یک ردیف برای هر منبع جایگزین می‌شود تا نمای جزئیات خالی نماند.
  const members = Array.isArray(story.members) ? story.members : [];
  out.members = members.length
    ? members.filter((member) => member && (member.url || member.title))
      .map((member) => pick(member, STORY_MEMBER_KEYS))
    : out.sources.filter((source) => source.url).map((source) => ({
      source_name: source.name,
      url: source.url,
      published: story.published,
    }));
  return out;
}

function healthOf(data) {
  return (data.source_health || []).map((source) => pick(source, HEALTH_KEYS));
}

function summaryOf(data, cards, health) {
  const stats = {};
  STAT_KEYS.forEach((key) => {
    if (data.stats && data.stats[key] !== undefined) stats[key] = data.stats[key];
  });
  const marketItems = (Array.isArray(data.markets) ? data.markets : ((data.markets && data.markets.items) || []))
    .slice(0, 14)
    .map((item) => ({ label: item.label, value: item.value, unit: item.unit, change_percent: item.change_percent }));
  return {
    generated_at: data.generated_at,
    stats,
    topics: (data.topics || []).slice(0, 12).map((topic) => ({ name: topic.name, count: topic.count })),
    markets: { items: marketItems },
    summary_lines: (data.summary_lines || []).slice(0, 4),
    source_health: health,
    articles: cards.slice(0, 40).map((article) => ({
      title: article.title, title_fa: article.title_fa, source_name: article.source_name, published: article.published,
    })),
  };
}

const escapeName = (key) => encodeURIComponent(key);

/**
 * دادهٔ کامل را به فایل‌های سبک تبدیل می‌کند. نتیجه بدون نوشتن روی دیسک
 * برگردانده می‌شود تا تست بتواند مستقیم بررسی‌اش کند.
 */
export function buildFeed(data, options = {}) {
  const head = Math.max(0, options.head ?? HEAD_COUNT);
  const chunkSize = Math.max(1, options.chunkSize ?? CHUNK_SIZE);
  const storyHead = Math.max(0, options.storyHead ?? STORY_HEAD);

  const articles = (data.articles || []).slice().sort(byDate);
  const cards = articles.map(cardOf);
  const details = new Map();
  articles.forEach((article) => {
    const key = articleKey(article);
    if (key) details.set(escapeName(key), detailOf(article));
  });

  const feed = pick(data, FEED_KEYS);
  feed.articles = cards.slice(0, head);
  feed.stories = (data.stories || []).slice(0, storyHead).map(storyOf);
  // فهرست تلگرام سنگی است؛ فقط وقتی بخشش دیده شود جدا خوانده می‌شود.
  feed.telegram = {
    posts: [],
    channels: Array.isArray(data.telegram && data.telegram.channels) ? data.telegram.channels : [],
    deferred: true,
  };

  // فهرست کوتاه منابع برای منوی فیلتر فید؛ فقط شناسه و نام، بدون خطا یا آینه.
  feed.sources = (Array.isArray(data.source_health) ? data.source_health : [])
    .map((source) => ({ id: source.id, name: source.name }))
    .filter((source) => source && source.name);

  const rest = cards.slice(head);
  const chunks = [];
  for (let i = 0; i * chunkSize < rest.length; i += 1) {
    const number = i + 1;
    chunks.push({
      generated_at: data.generated_at,
      chunk: number,
      chunk_size: chunkSize,
      articles: rest.slice(i * chunkSize, (i + 1) * chunkSize),
    });
  }

  const telegram = data.telegram || {};
  const health = healthOf(data);
  return {
    feed,
    chunks,
    details,
    telegram: {
      generated_at: data.generated_at,
      telegram: {
        posts: Array.isArray(telegram.posts) ? telegram.posts : [],
        channels: Array.isArray(telegram.channels) ? telegram.channels : [],
      },
    },
    health: { generated_at: data.generated_at, source_health: health },
    summary: summaryOf(data, cards, health),
    counts: { articles: articles.length, head: head, chunks: chunks.length, details: details.size },
  };
}

export function writeSite(data, outDir, options = {}) {
  const built = buildFeed(data, options);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'feed.json'), JSON.stringify(built.feed));
  built.chunks.forEach((chunk) => {
    fs.writeFileSync(path.join(outDir, 'feed-more-' + chunk.chunk + '.json'), JSON.stringify(chunk));
  });
  const detailDir = path.join(outDir, 'detail');
  fs.rmSync(detailDir, { recursive: true, force: true });
  fs.mkdirSync(detailDir, { recursive: true });
  built.details.forEach((detail, name) => {
    fs.writeFileSync(path.join(detailDir, name + '.json'), JSON.stringify({ detail }));
  });
  fs.writeFileSync(path.join(outDir, 'telegram.json'), JSON.stringify(built.telegram));
  fs.writeFileSync(path.join(outDir, 'health.json'), JSON.stringify(built.health));
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(built.summary));
  return built;
}

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index !== -1 && argv[index + 1] ? argv[index + 1] : fallback;
}

function main() {
  const dataFile = argValue(process.argv, '--data', 'data.json');
  const outDir = argValue(process.argv, '--out', '_site');
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const built = writeSite(data, outDir);
  const feedBytes = fs.statSync(path.join(outDir, 'feed.json')).size;
  const detailBytes = Array.from(built.details.values()).reduce((sum, detail) => sum + Buffer.byteLength(JSON.stringify({ detail })), 0);
  console.log('feed.json: ' + Math.round(feedBytes / 1024) + ' KB (' + built.counts.head + ' کارت)');
  console.log('آرشیو: ' + built.counts.chunks + ' قطعه · ' + built.counts.articles + ' خبر');
  console.log('جزئیات: ' + built.counts.details + ' فایل · ' + Math.round(detailBytes / 1024) + ' KB');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
