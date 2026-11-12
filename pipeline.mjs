// خط تولید داده: دریافت همهٔ خبرها، ترجمهٔ فارسی، تحلیل و ساخت خروجی‌ها
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { SOURCES, UPDATE_INTERVAL_MINUTES } from './src/sources.mjs';
import { parseFeed, stripHtml, cleanText } from './src/parse.mjs';
import {
  detectTopics,
  analyzeSentiment,
  extractKeywords,
  clusterArticles,
  buildStories,
  computeImportance,
  normalizeTitle,
  uniqueBy,
  TOPICS,
} from './src/analyze.mjs';
import { translateMany, saveCache } from './src/translate.mjs';
import { fetchMarkets, buildMarketHistory, MARKET_SOURCE } from './src/markets.mjs';
import { buildXlsx } from './src/xlsx.mjs';

const ROOT = path.resolve('.');
const DATA_FILE = path.join(ROOT, 'data.json');
const XLSX_FILE = path.join(ROOT, 'news.xlsx');
const CACHE_DIR = path.join(ROOT, '.cache');
const HISTORY_FILE = path.join(CACHE_DIR, 'history.json');
const SEEN_FILE = path.join(CACHE_DIR, 'seen.json');
const MAX_PER_SOURCE = 50;
const MAX_ARTICLES = 1400;

const faNumber = (value, digits = 0) =>
  Number(value || 0).toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0);
const round = (value, digits = 1) => Number(Number(value).toFixed(digits));
const nowIso = () => new Date().toISOString();

function hashId(input) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, 20);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value, pretty = false) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, pretty ? JSON.stringify(value, null, 1) : JSON.stringify(value), 'utf8');
}

async function fetchWithTimeout(url, timeoutMs = 25000) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      // برخی منابع (مثل CBC) با User-Agent برنامه‌ای خطای HTTP/2 می‌دهند.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      'Accept-Language': 'fa,en;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function cleanAggregatorTitle(title, source) {
  if (!source.aggregator) return title;
  const match = title.match(/^(.*?)\s+[-–—]\s+([^-–—]{2,40})$/);
  return match ? match[1].trim() : title;
}

const AD_PATTERN = /intro apr|balance transfer|student loan|casino|sponsored|advertisement|promo code|giveaway|% off|sign up now/i;

// فیلتر عنوان‌های بی‌کیفیت (تبلیغات، عنوان‌های نمادی و خوراک‌های خراب)
function isUsableTitle(title) {
  const letters = (title.match(/\p{L}/gu) || []).length;
  if (letters < 12) return false;
  const compact = title.replace(/\s+/g, '');
  if (letters / Math.max(1, compact.length) < 0.5) return false;
  if (/^(comments?|sponsored|advertisement|video|photo)$/i.test(title)) return false;
  if (AD_PATTERN.test(title)) return false;
  return true;
}

async function fetchSource(source) {
  const started = Date.now();
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const xml = await fetchWithTimeout(source.url);
      const parsed = parseFeed(xml, source);
      if (!parsed.items.length) throw new Error('خوراک خالی بود');
      return { source, items: parsed.items, elapsed: Date.now() - started, error: '' };
    } catch (error) {
      lastError = String(error?.name === 'TimeoutError' ? 'زمان پاسخ به پایان رسید' : error.message || error);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return { source, items: [], elapsed: Date.now() - started, error: lastError };
}

async function fetchAllSources() {
  const results = [];
  const queue = [...SOURCES];
  const concurrency = 8;

  async function worker() {
    while (queue.length) {
      const source = queue.shift();
      const result = await fetchSource(source);
      results.push(result);
      const state = result.error ? `خطا: ${result.error}` : `${result.items.length} مورد`;
      console.log(`  ${result.source.name.padEnd(24, ' ')} ${state} (${result.elapsed}ms)`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, SOURCES.length) }, worker));
  return results;
}

function buildSourceHealth(results, total, acceptedCounts = new Map()) {
  return results
    .map(({ source, items, elapsed, error }) => {
      const count = acceptedCounts.get(source.id) || 0;
      return {
        id: source.id,
        name: source.name,
        url: source.url,
        lang: source.lang,
        origin: source.origin || 'foreign',
        weight: source.weight,
        count,
        percent: pct(count, total),
        ok: !error,
        status: error ? 'fail' : count ? 'ok' : 'idle',
        items_seen: items.length,
        error,
        elapsed_ms: elapsed,
        success_percent: error ? 0 : 100,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fa'));
}

function pickHourly(articles) {
  const buckets = new Map();
  const now = Date.now();
  for (let i = 23; i >= 0; i--) {
    const start = new Date(now - i * 3600 * 1000);
    start.setMinutes(0, 0, 0);
    const key = start.toISOString();
    buckets.set(key, 0);
  }
  for (const article of articles) {
    const ts = new Date(article.published).getTime();
    if (!Number.isFinite(ts) || now - ts > 24 * 3600 * 1000) continue;
    const hour = new Date(ts);
    hour.setMinutes(0, 0, 0);
    const key = hour.toISOString();
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  }
  const list = [...buckets.entries()].map(([hour, count]) => ({ hour, count }));
  const max = Math.max(1, ...list.map((b) => b.count));
  const total = list.reduce((a, b) => a + b.count, 0);
  return {
    buckets: list.map((b) => ({ ...b, percent: pct(b.count, total), height_percent: pct(b.count, max) })),
    total,
    peak: list.reduce((acc, b) => (b.count > acc.count ? b : acc), { hour: '', count: 0 }),
  };
}

function buildAnalysis(data) {
  const { stats, topics, sentiment, source_health, stories, articles, keywords, hourly } = data;
  const findings = [];
  const alerts = [];

  const topTopic = topics[0];
  if (topTopic) {
    findings.push({
      id: 'top-topic',
      title: `تمرکز اصلی خبر‌ها: ${topTopic.name}`,
      percent: topTopic.percent,
      value: topTopic.count,
      detail: `${faNumber(topTopic.count)} خبر (${faNumber(topTopic.percent, 1)}٪ از کل) در حوزهٔ ${topTopic.name} منتشر شده است؛ ${topTopic.top_keywords.slice(0, 3).map((k) => `«${k}»`).join('، ')} پرتکرارترین کلیدواژه‌های این حوزه‌اند.`,
    });
  }

  findings.push({
    id: 'language-split',
    title: 'ترکیب زبانی پوشش خبری',
    percent: stats.fa_percent,
    value: stats.fa,
    detail: `${faNumber(stats.fa)} خبر فارسی (${faNumber(stats.fa_percent, 1)}٪) و ${faNumber(stats.en)} خبر انگلیسی (${faNumber(stats.en_percent, 1)}٪) رصد شد؛ یعنی به ازای هر خبر انگلیسی حدود ${faNumber(stats.en ? stats.fa / stats.en : 0, 1)} خبر فارسی منتشر شده است.`,
  });

  findings.push({
    id: 'origin',
    title: 'سهم رسانه‌های خارجی و تنوع منابع',
    percent: stats.foreign_percent,
    value: stats.foreign,
    detail: `${faNumber(stats.foreign)} خبر (${faNumber(stats.foreign_percent, 1)}٪) از ${faNumber(stats.foreign_sources)} رسانهٔ خارج از ایران و ${faNumber(stats.iran)} خبر (${faNumber(stats.iran_percent, 1)}٪) از ${faNumber(stats.iran_sources)} رسانهٔ ایرانی رصد شده است؛ این ترکیب تصویر خبری را از یک منبع واحد جدا می‌کند.`,
  });

  findings.push({
    id: 'sentiment',
    title: 'وضعیت احساس عمومی اخبار',
    percent: Math.abs(sentiment.score) * 100,
    value: sentiment.score,
    detail: `احساس غالب «${sentiment.dominant_label}» با ${faNumber(sentiment.dominant_percent, 1)}٪ است؛ ${faNumber(sentiment.positive_percent, 1)}٪ مثبت، ${faNumber(sentiment.negative_percent, 1)}٪ منفی و ${faNumber(sentiment.neutral_percent, 1)}٪ خنثی. شاخص کلی احساس ${faNumber(sentiment.score * 100, 1)} از ۱۰۰ است.`,
  });

  findings.push({
    id: 'coverage',
    title: 'پوشش چندمنبعی و تکرار خبر',
    percent: stats.multi_source_percent,
    value: stats.multi_source_stories,
    detail: `${faNumber(stats.stories)} قصهٔ خبری متمایز شناسایی شد که ${faNumber(stats.multi_source_stories)} مورد (${faNumber(stats.multi_source_percent, 1)}٪) توسط بیش از یک منبع پوشش داده شده‌اند. ${faNumber(stats.multi_source_articles)} خبر (${faNumber(stats.multi_source_articles_percent, 1)}٪) در خوشه‌ای با بیش از یک منبع قرار دارند و میانگین تعداد منبع هر خبر ${faNumber(stats.avg_sources_per_article, 2)} است. نرخ تکرار/بازنشر ${faNumber(stats.duplicate_percent, 1)}٪ است، یعنی ${faNumber(stats.duplicates)} خبر در خوشه‌ای با خبر دیگر ادغام شد.`,
  });

  findings.push({
    id: 'health',
    title: 'سلامت منابع رصد',
    percent: stats.health_percent,
    value: stats.sources_ok,
    detail: `از ${faNumber(stats.sources_total)} منبع پیکربندی‌شده، ${faNumber(stats.sources_ok)} منبع سالم (${faNumber(stats.health_percent, 1)}٪) و ${faNumber(stats.sources_with_news)} منبع دارای خبر تازه است. پرکارترین منبع «${source_health[0]?.name || '—'}» با سهم ${faNumber(source_health[0]?.percent || 0, 1)}٪ از کل اخبار است.`,
  });

  findings.push({
    id: 'translation',
    title: 'پوشش ترجمهٔ فارسی',
    percent: stats.translation_coverage_percent,
    value: stats.translated,
    detail: `${faNumber(stats.en)} خبر انگلیسی شناسایی شد و ${faNumber(stats.translated)} مورد (${faNumber(stats.translation_coverage_percent, 1)}٪) به فارسی برگردانده شد؛ میانگین کیفیت ترجمه ${faNumber(stats.translation_quality_percent, 1)}٪ است و کلیدواژه‌های خبرهای انگلیسی نیز در تحلیل لحاظ شده‌اند.`,
  });

  const peakHour = hourly.peak;
  findings.push({
    id: 'timeline',
    title: 'اوج انتشار خبر در ۲۴ ساعت گذشته',
    percent: hourly.total ? pct(peakHour.count, hourly.total) : 0,
    value: peakHour.count,
    detail: peakHour.hour
      ? `بیشترین تراکم انتشار در ساعت ${new Date(peakHour.hour).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' })} به وقت تهران با ${faNumber(peakHour.count)} خبر (${faNumber(pct(peakHour.count, hourly.total), 1)}٪ از اخبار ۲۴ ساعت گذشته) ثبت شد.`
      : 'در ۲۴ ساعت گذشته خبری با زمان انتشار معتبر ثبت نشده است.',
  });

  findings.push({
    id: 'keywords',
    title: 'پرتکرارترین کلیدواژه‌ها',
    percent: keywords[0]?.percent || 0,
    value: keywords[0]?.count || 0,
    detail: keywords.slice(0, 6).map((k) => `«${k.word}» (${faNumber(k.count)} بار، ${faNumber(k.percent, 1)}٪ از اخبار)`).join('، ') + '.',
  });

  if (stats.negative_percent >= 35) {
    alerts.push({ level: 'high', text: `سهم اخبار منفی به ${faNumber(stats.negative_percent, 1)}٪ رسیده است؛ پایش موضوع‌های «${topics[0]?.name || '—'}» و «${topics[1]?.name || '—'}» توصیه می‌شود.` });
  }
  if (stats.health_percent < 80) {
    alerts.push({ level: 'medium', text: `${faNumber(stats.sources_total - stats.sources_ok)} منبع پاسخ نداده است؛ درصد سلامت منابع ${faNumber(stats.health_percent, 1)}٪ است.` });
  }
  if (stats.translation_coverage_percent < 90 && stats.en > 0) {
    alerts.push({ level: 'medium', text: `پوشش ترجمه ${faNumber(stats.translation_coverage_percent, 1)}٪ است؛ بخشی از خبرهای انگلیسی هنوز ترجمه نشده‌اند و در به‌روزرسانی بعدی تکمیل می‌شود.` });
  }
  if (stats.multi_source_percent >= 25) {
    alerts.push({ level: 'info', text: `${faNumber(stats.multi_source_percent, 1)}٪ از قصه‌ها چندمنبعی هستند؛ این نشانهٔ اهمیت بالای آن قصه‌ها در فضای خبری است.` });
  }
  if (stats.fresh_24h_percent < 40) {
    alerts.push({ level: 'info', text: `تنها ${faNumber(stats.fresh_24h_percent, 1)}٪ از اخبار مربوط به ۲۴ ساعت گذشته است؛ بقیه از آرشیو خوراک منابع می‌آیند.` });
  }

  const trendNotes = topics
    .filter((topic) => topic.trend_percent !== null && Math.abs(topic.trend_percent) >= 15)
    .slice(0, 4)
    .map((topic) => `«${topic.name}» ${topic.trend_percent > 0 ? 'رشد' : 'کاهش'} ${faNumber(Math.abs(topic.trend_percent), 1)}٪ نسبت به یک ساعت گذشته`);

  const lines = [];
  lines.push(`در این به‌روزرسانی ${faNumber(stats.total)} خبر از ${faNumber(stats.sources_with_news)} منبع خبری رصد شد؛ ${faNumber(stats.fa_percent, 1)}٪ فارسی و ${faNumber(stats.en_percent, 1)}٪ انگلیسی.`);
  lines.push(`حوزه‌های غالب: ${topics.slice(0, 4).map((t) => `${t.name} ${faNumber(t.percent, 1)}٪`).join('، ')}.`);
  lines.push(`قصه‌های چندمنبعی ${faNumber(stats.multi_source_stories)} مورد (${faNumber(stats.multi_source_percent, 1)}٪) و میانگین درصد اهمیت اخبار ${faNumber(stats.avg_importance, 1)}٪ است.`);
  lines.push(`شاخص احساس ${faNumber(sentiment.score * 100, 1)}؛ ${faNumber(sentiment.negative_percent, 1)}٪ اخبار منفی و ${faNumber(sentiment.positive_percent, 1)}٪ مثبت.`);
  lines.push(trendNotes.length ? `روند یک‌ساعته: ${trendNotes.join('؛ ')}.` : 'روند یک‌ساعته هنوز مبنای کافی ندارد و پس از چند به‌روزرسانی محاسبه می‌شود.');
  lines.push(`پوشش ترجمهٔ فارسی ${faNumber(stats.translation_coverage_percent, 1)}٪ با کیفیت میانگین ${faNumber(stats.translation_quality_percent, 1)}٪.`);

  const headline = `در ${faNumber(stats.total)} خبر تازه، «${topics[0]?.name || 'بین‌الملل'}» با ${faNumber(topics[0]?.percent || 0, 1)}٪ غالب است و ${faNumber(sentiment.negative_percent, 1)}٪ اخبار لحن منفی دارند.`;

  return { headline, lines, findings, alerts, trend_notes: trendNotes };
}

function pickTopicKeywords(articles, topicId, limit = 5) {
  const counts = new Map();
  for (const article of articles) {
    if (!article.topics.some((t) => t.id === topicId)) continue;
    for (const keyword of article.keywords.slice(0, 3)) counts.set(keyword, (counts.get(keyword) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

export async function runPipeline({ quiet = false } = {}) {
  const startedAt = Date.now();
  const generatedAt = nowIso();
  const log = (...args) => { if (!quiet) console.log(...args); };

  // قیمت طلا و دلار هم‌زمان با خبرها خوانده می‌شود؛ اگر نشد، مقدار موفق قبلی حفظ می‌شود
  const previousData = await readJson(DATA_FILE, null);
  const marketsPromise = fetchMarkets({ previous: previousData?.markets || null }).catch((error) => ({
    ok: false,
    stale: true,
    source: MARKET_SOURCE,
    items: [],
    history: previousData?.markets?.history || [],
    error: String(error?.message || error),
    summary_text: '',
  }));

  log('› دریافت خوراک منابع…');
  const results = await fetchAllSources();
  const collected = [];
  const seenLinks = new Set();
  const acceptedBySource = new Map();

  for (const { source, items } of results) {
    let accepted = 0;
    for (const raw of items) {
      if (accepted >= MAX_PER_SOURCE) break;
      const title = cleanText(stripHtml(cleanAggregatorTitle(cleanText(raw.title), source)))
        .replace(/^[\u200c\s]+|[\u200c\s]+$/g, '')
        .slice(0, 260);
      if (!isUsableTitle(title)) continue;
      const link = String(raw.link || '').trim();
      const linkKey = link || normalizeTitle(title);
      if (seenLinks.has(linkKey)) continue;
      seenLinks.add(linkKey);
      accepted += 1;
      collected.push({ ...raw, title, link, source });
    }
    acceptedBySource.set(source.id, accepted);
  }

  const nowTs = Date.now();
  const history = await readJson(HISTORY_FILE, { runs: [] });
  const seenStore = await readJson(SEEN_FILE, { items: {} });
  const seenItems = seenStore.items || {};

  log(`› ${collected.length} خبر خام از ${results.filter((r) => r.items.length).length} منبع`);

  // ترجمهٔ عنوان و خلاصهٔ خبرهای انگلیسی
  const english = collected.filter((item) => item.source.lang === 'en');
  // ابتدا همهٔ عنوان‌ها و سپس خلاصه‌ها ترجمه می‌شوند تا حتی با محدودیت زمانی، عنوان خبر فارسی شود
  const includeSummaries = process.env.TRANSLATE_SUMMARIES !== '0';
  const translationInputs = [
    ...english.map((item) => item.title),
    ...(includeSummaries ? english.filter((item) => item.summary).map((item) => item.summary.slice(0, 900)) : []),
  ];
  const budgetMs = Number(process.env.TRANSLATE_BUDGET_MS ?? 600000);
  const translateStarted = Date.now();
  const titleTexts = english.map((item) => item.title);
  const summaryTexts = includeSummaries ? english.filter((item) => item.summary).map((item) => item.summary.slice(0, 900)) : [];
  log(`› ترجمهٔ ${titleTexts.length} عنوان و ${summaryTexts.length} خلاصهٔ انگلیسی به فارسی…`);
  const translations = new Map();
  // اولویت اول: عنوان‌ها (کیفیت نمایش صفحه به آن‌ها وابسته است)
  const titleMap = await translateMany(titleTexts, {
    concurrency: Number(process.env.TRANSLATE_CONCURRENCY || 4),
    deadline: Date.now() + Math.round(budgetMs * 0.65),
    onProgress: (done, total) => { if (!quiet && (done % 20 === 0 || done === total)) console.log(`   عنوان ${done}/${total}`); },
  });
  for (const [key, value] of titleMap) translations.set(key, value);
  const titleCoverage = titleTexts.length ? [...titleMap.values()].filter((value) => value?.text).length / titleTexts.length : 1;
  // خلاصه‌ها فقط وقتی ۸۰٪ عنوان‌ها ترجمه شده باشند (تا بودجه هدر نرود)
  if (summaryTexts.length && titleCoverage >= 0.8) {
    const remaining = Math.max(60000, budgetMs - (Date.now() - translateStarted));
    const summaryMap = await translateMany(summaryTexts, {
      concurrency: Number(process.env.TRANSLATE_CONCURRENCY || 4),
      deadline: Date.now() + remaining,
      onProgress: (done, total) => { if (!quiet && (done % 50 === 0 || done === total)) console.log(`   خلاصه ${done}/${total}`); },
    });
    for (const [key, value] of summaryMap) translations.set(key, value);
  } else if (summaryTexts.length) {
    log(`› خلاصه‌ها به اجرای بعد موکول شد (پوشش عنوان‌ها ${Math.round(titleCoverage * 100)}٪)`);
  }
  await saveCache();

  const articles = [];
  let translationQualitySum = 0;
  let translatedCount = 0;
  const providerCounts = {};

  for (const item of collected.slice(0, MAX_ARTICLES)) {
    const source = item.source;
    const publishedRaw = item.published ? new Date(item.published) : new Date();
    const publishedTs = Number.isFinite(publishedRaw.getTime()) ? publishedRaw.getTime() : nowTs;
    const ageHours = Math.max(0, (nowTs - publishedTs) / 3600000);
    const safePublished = new Date(Math.min(publishedTs, nowTs + 3600 * 1000)).toISOString();

    const uid = hashId(`${source.id}|${item.link || item.title}`);
    const topics = detectTopics(item.title, item.summary, source.lang, source.defaultTopic);
    const sentiment = analyzeSentiment(item.title, item.summary, source.lang);

    const REAL_PROVIDERS = ['google', 'llm', 'pollinations', 'bing', 'mymemory', 'libretranslate'];
    let titleFa = '';
    let summaryFa = '';
    let translation = { provider: 'none', quality: 0, is_translation: false, translated_at: null };

    if (source.lang === 'fa') {
      translation = { provider: 'source', quality: 100, is_translation: false, translated_at: null };
    } else {
      const titleResult = translations.get(item.title);
      const summaryResult = item.summary ? translations.get(item.summary.slice(0, 900)) : null;
      const titleOk = titleResult?.text && REAL_PROVIDERS.includes(titleResult.provider);
      if (titleOk) {
        titleFa = titleResult.text;
        translation = {
          provider: titleResult.provider,
          quality: titleResult.quality || 0,
          is_translation: true,
          translated_at: titleResult.at || generatedAt,
          cached: Boolean(titleResult.cached),
        };
        if (summaryResult?.text && REAL_PROVIDERS.includes(summaryResult.provider)) summaryFa = summaryResult.text;
        translatedCount += 1;
        translationQualitySum += translation.quality || 0;
        providerCounts[translation.provider] = (providerCounts[translation.provider] || 0) + 1;
      } else {
        translation.pending = true;
      }
    }

    // کلیدواژه‌ها از متن فارسی (برای خبرهای ترجمه‌شده) استخراج می‌شوند تا ابر کلیدواژه‌ها فارسی بماند
    const keywordText = titleFa || item.title;
    const keywordSummary = summaryFa || item.summary;
    const keywords = extractKeywords(keywordText, keywordSummary, titleFa ? 'fa' : source.lang, 6);

    articles.push({
      uid,
      source_id: source.id,
      source_name: source.name,
      lang: source.lang,
      title: item.title,
      title_fa: titleFa,
      link: item.link,
      summary: String(item.summary || '').slice(0, 600),
      summary_fa: String(summaryFa || '').slice(0, 600),
      published: safePublished,
      age_hours: round(ageHours, 1),
      sentiment: sentiment.score,
      sentiment_label: sentiment.label,
      topics,
      keywords,
      translation,
      importance: 0,
      importance_percent: 0,
      coverage_percent: 0,
      cluster_size: 1,
      is_new: !seenItems[uid],
    });
  }

  log(`› خوشه‌بندی ${articles.length} خبر…`);
  const clusters = clusterArticles(articles);
  const clusterByUid = new Map();
  for (const cluster of clusters) {
    for (const member of cluster.members) clusterByUid.set(member.uid, cluster);
  }

  const maxCluster = Math.max(1, ...clusters.map((c) => c.members.length));
  for (const article of articles) {
    const cluster = clusterByUid.get(article.uid);
    const clusterSize = cluster ? cluster.members.length : 1;
    const topicScore = article.topics[0]?.score || 0;
    const importance = computeImportance({
      ageHours: article.age_hours,
      sourceWeight: SOURCES.find((s) => s.id === article.source_id)?.weight || 0.7,
      clusterSize,
      topicScore,
      sentimentScore: article.sentiment,
    });
    const clusterMembers = cluster ? cluster.members : [article];
    const memberSources = [...new Map(clusterMembers.map((m) => [m.source_id, m.source_name])).entries()];
    article.cluster_size = clusterSize;
    article.source_count = memberSources.length;
    article.sources = memberSources.slice(0, 6).map(([, name]) => name);
    article.importance = importance.total;
    article.importance_percent = importance.total;
    article.coverage_percent = round((clusterSize / maxCluster) * 100, 1);
  }

  articles.sort((a, b) => new Date(b.published) - new Date(a.published));

  const stories = buildStories(clusters, articles.length);

  // موضوع‌ها
  const topicStats = new Map(TOPICS.map((t) => [t.id, { ...t, count: 0, sentimentSum: 0 }]));
  for (const article of articles) {
    for (const topic of article.topics) {
      const entry = topicStats.get(topic.id);
      if (!entry) continue;
      entry.count += 1;
      entry.sentimentSum += article.sentiment;
    }
  }

  const previousRun = [...(history.runs || [])].reverse().find((run) => Date.now() - new Date(run.at).getTime() >= 45 * 60 * 1000);
  const topics = [...topicStats.values()]
    .filter((topic) => topic.count > 0)
    .map((topic) => {
      const base = previousRun?.topics?.[topic.id];
      const trend = typeof base === 'number' && base > 0 ? round(((topic.count - base) / base) * 100, 1) : null;
      return {
        id: topic.id,
        name: topic.name,
        count: topic.count,
        percent: pct(topic.count, articles.length),
        sentiment: round(topic.sentimentSum / Math.max(1, topic.count), 3),
        sentiment_percent: round((topic.sentimentSum / Math.max(1, topic.count)) * 100, 1),
        trend_percent: trend,
        top_keywords: pickTopicKeywords(articles, topic.id, 5),
        trend: trend === null ? 'stable' : trend > 5 ? 'up' : trend < -5 ? 'down' : 'stable',
      };
    })
    .sort((a, b) => b.count - a.count);

  // احساس
  const sentimentCounts = { 'مثبت': 0, 'منفی': 0, 'خنثی': 0 };
  let sentimentSum = 0;
  for (const article of articles) {
    sentimentCounts[article.sentiment_label] = (sentimentCounts[article.sentiment_label] || 0) + 1;
    sentimentSum += article.sentiment;
  }
  const dominant = Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0] || ['خنثی', 0];
  const sentiment = {
    score: articles.length ? round(sentimentSum / articles.length, 3) : 0,
    dominant_label: dominant[0],
    dominant_percent: pct(dominant[1], articles.length),
    positive: sentimentCounts['مثبت'] || 0,
    negative: sentimentCounts['منفی'] || 0,
    neutral: sentimentCounts['خنثی'] || 0,
    positive_percent: pct(sentimentCounts['مثبت'] || 0, articles.length),
    negative_percent: pct(sentimentCounts['منفی'] || 0, articles.length),
    neutral_percent: pct(sentimentCounts['خنثی'] || 0, articles.length),
    distribution: [
      { key: 'positive', label: 'مثبت', count: sentimentCounts['مثبت'] || 0, percent: pct(sentimentCounts['مثبت'] || 0, articles.length), color: '#059669' },
      { key: 'negative', label: 'منفی', count: sentimentCounts['منفی'] || 0, percent: pct(sentimentCounts['منفی'] || 0, articles.length), color: '#dc2626' },
      { key: 'neutral', label: 'خنثی', count: sentimentCounts['خنثی'] || 0, percent: pct(sentimentCounts['خنثی'] || 0, articles.length), color: '#94a3b8' },
    ],
  };

  // کلیدواژه‌ها
  const keywordCounts = new Map();
  for (const article of articles) {
    for (const keyword of new Set(article.keywords.map((word) => word.replace(/^[\u200c\s]+|[\u200c\s]+$/g, '')))) {
      if (!keyword || keyword.length < 3) continue;
      if (/^\d+$/.test(keyword)) continue;
      if (/^(comments?|november|december|january|february|2025|2026|2027|said|says|ویدیو|عکس)$/i.test(keyword)) continue;
      keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
    }
  }
  const keywords = [...keywordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([word, count]) => ({ word, count, percent: pct(count, articles.length), size_percent: 0 }));
  const maxKeyword = Math.max(1, ...keywords.map((k) => k.count));
  for (const keyword of keywords) keyword.size_percent = round(Math.max(38, (keyword.count / maxKeyword) * 100), 0);

  const fresh24 = articles.filter((article) => article.age_hours <= 24).length;
  const multiSourceStories = stories.filter((story) => story.source_count > 1);
  // درصد هر منبع فقط بر پایهٔ خبرهای نهایی (پس از سقف کل) محاسبه می‌شود تا جمع درصدها ۱۰۰ باشد
  const countsBySource = new Map();
  for (const article of articles) countsBySource.set(article.source_id, (countsBySource.get(article.source_id) || 0) + 1);
  const sourceHealth = buildSourceHealth(results, articles.length, countsBySource);
  const sourcesOk = sourceHealth.filter((s) => s.ok).length;
  const sourcesWithNews = sourceHealth.filter((s) => s.count > 0).length;
  const avgImportance = articles.length ? articles.reduce((acc, a) => acc + a.importance, 0) / articles.length : 0;
  const englishCount = articles.filter((a) => a.lang === 'en').length;
  const translated = articles.filter((a) => a.lang === 'en' && a.translation.is_translation).length;
  const translationCoverage = pct(translated, Math.max(1, englishCount));
  const translationQuality = translated ? translationQualitySum / Math.max(1, translated) : 0;
  const translationPending = englishCount - translated;
  const hourly = pickHourly(articles);
  const duplicates = articles.length - stories.length;
  const newCount = articles.filter((a) => a.is_new).length;
  const originOf = (sourceId) => SOURCES.find((s) => s.id === sourceId)?.origin || 'foreign';
  const foreignArticles = articles.filter((a) => originOf(a.source_id) === 'foreign').length;
  const multiSourceArticles = articles.filter((a) => (a.source_count || 1) > 1).length;
  const avgSourcesPerArticle = articles.length ? articles.reduce((acc, a) => acc + (a.source_count || 1), 0) / articles.length : 0;

  const stats = {
    total: articles.length,
    fa: articles.filter((a) => a.lang === 'fa').length,
    en: articles.filter((a) => a.lang === 'en').length,
    fa_percent: pct(articles.filter((a) => a.lang === 'fa').length, articles.length),
    en_percent: pct(articles.filter((a) => a.lang === 'en').length, articles.length),
    foreign: foreignArticles,
    foreign_percent: pct(foreignArticles, articles.length),
    iran: articles.length - foreignArticles,
    iran_percent: pct(articles.length - foreignArticles, articles.length),
    foreign_sources: SOURCES.filter((s) => s.origin === 'foreign').length,
    iran_sources: SOURCES.filter((s) => s.origin === 'iran').length,
    multi_source_articles: multiSourceArticles,
    multi_source_articles_percent: pct(multiSourceArticles, articles.length),
    avg_sources_per_article: round(avgSourcesPerArticle, 2),
    fresh_24h: fresh24,
    fresh_24h_percent: pct(fresh24, articles.length),
    sources_total: SOURCES.length,
    sources_ok: sourcesOk,
    sources_with_news: sourcesWithNews,
    health_percent: pct(sourcesOk, SOURCES.length),
    stories: stories.length,
    multi_source_stories: multiSourceStories.length,
    multi_source_percent: pct(multiSourceStories.length, Math.max(1, stories.length)),
    duplicates,
    duplicate_percent: pct(duplicates, Math.max(1, articles.length)),
    avg_importance: round(avgImportance, 1),
    avg_importance_percent: round(avgImportance, 1),
    english: englishCount,
    translated,
    untranslated: englishCount - translated,
    translation_coverage_percent: translationCoverage,
    translation_quality_percent: round(translationQuality, 1),
    translation_pending: translationPending,
    new_since_last: newCount,
    new_since_last_percent: pct(newCount, Math.max(1, articles.length)),
    peak_hour_count: hourly.peak.count,
    run_ms: Date.now() - startedAt,
    errors: sourceHealth.filter((s) => !s.ok).length,
    update_interval_minutes: UPDATE_INTERVAL_MINUTES,
    generated_at: generatedAt,
  };

  const markets = await marketsPromise;
  if (markets.items.length) {
    markets.history = await buildMarketHistory({ previousHistory: previousData?.markets?.history || null, markets });
  }
  log(
    markets.items.length
      ? `› بازار: ${markets.items.length} نرخ (${markets.ok ? 'تازه' : 'آخرین مقدار موفق'})`
      : '› بازار: نرخی دریافت نشد'
  );

  const data = {
    generated_at: generatedAt,
    next_update_at: new Date(Date.now() + UPDATE_INTERVAL_MINUTES * 60000).toISOString(),
    update_interval_minutes: UPDATE_INTERVAL_MINUTES,
    window_hours: null,
    window_label: 'همهٔ خبرها (بدون محدودیت زمانی)',
    markets,
    stats,
    summary_lines: [],
    analysis: null,
    topics,
    sentiment,
    stories,
    articles,
    keywords,
    keyword_counts: Object.fromEntries(keywords.slice(0, 60).map((k) => [k.word, k.count])),
    source_health: sourceHealth,
    hourly,
    translations: {
      provider: (() => {
        const labels = { google: 'Google', bing: 'Bing', mymemory: 'MyMemory', libretranslate: 'LibreTranslate', llm: 'LLM', pollinations: 'Pollinations AI' };
        const top = Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0];
        return top ? labels[top[0]] || top[0] : 'none';
      })(),
      providers: providerCounts,
      total: englishCount,
      translated,
      untranslated: englishCount - translated,
      coverage_percent: translationCoverage,
      avg_quality_percent: round(translationQuality, 1),
      note: 'خبرهای انگلیسی به‌صورت خودکار به فارسی برگردانده می‌شوند و متن اصلی نیز حفظ می‌شود؛ خبرهای در انتظار ترجمه با متن اصلی نمایش داده می‌شوند.',
    },
  };

  const analysis = buildAnalysis(data);
  data.analysis = analysis;
  data.summary_lines = [
    ...(markets.summary_text
      ? [markets.summary_text, `نرخ‌های طلا، سکه و ارز از ${MARKET_SOURCE} خوانده می‌شود و در هر به‌روزرسانی تازه می‌شود.`]
      : []),
    `در مجموع ${faNumber(stats.total)} خبر از ${faNumber(sourcesWithNews)} منبع فعال رصد شد؛ ${faNumber(stats.fa)} خبر فارسی (${faNumber(stats.fa_percent, 1)}٪) و ${faNumber(stats.en)} خبر انگلیسی (${faNumber(stats.en_percent, 1)}٪).`,
    `پرجوش‌ترین حوزه‌های خبری: ${topics.slice(0, 3).map((t) => `${t.name} (${faNumber(t.count)} خبر، ${faNumber(t.percent, 1)}٪)`).join('، ')}.`,
    `سهم رسانه‌های خارج از ایران ${faNumber(stats.foreign_percent, 1)}٪ (${faNumber(stats.foreign)} خبر از ${faNumber(stats.foreign_sources)} رسانه) و سهم رسانه‌های ایرانی ${faNumber(stats.iran_percent, 1)}٪ (${faNumber(stats.iran)} خبر از ${faNumber(stats.iran_sources)} رسانه) است.`,
    `${faNumber(stats.multi_source_articles)} خبر (${faNumber(stats.multi_source_articles_percent, 1)}٪) از بیش از یک منبع گزارش شده‌اند؛ میانگین تعداد منبع هر خبر ${faNumber(stats.avg_sources_per_article, 2)} است.`,
    stories[0]
      ? `پرپوشش‌ترین خبر: «${stories[0].title}» با ${faNumber(stories[0].source_count)} منبع مستقل و پوشش ${faNumber(stories[0].coverage_percent, 1)}٪ نسبت به پرپوشش‌ترین قصه.`
      : 'قصهٔ خبری چندمنبعی در این بازه یافت نشد.',
    `احساس غالب «${sentiment.dominant_label}» است: ${faNumber(sentiment.positive_percent, 1)}٪ مثبت، ${faNumber(sentiment.negative_percent, 1)}٪ منفی و ${faNumber(sentiment.neutral_percent, 1)}٪ خنثی؛ شاخص احساس ${faNumber(sentiment.score * 100, 1)} از ۱۰۰.`,
    `کلیدواژه‌های پرتکرار: ${keywords.slice(0, 5).map((k) => `${k.word} (${faNumber(k.percent, 1)}٪)`).join('، ')}.`,
    `پرکارترین منابع: ${sourceHealth.slice(0, 3).map((s) => `${s.name} (${faNumber(s.count)} خبر، ${faNumber(s.percent, 1)}٪)`).join('، ')}؛ سلامت منابع ${faNumber(stats.health_percent, 1)}٪.`,
    `پوشش ترجمهٔ فارسی ${faNumber(stats.translation_coverage_percent, 1)}٪ و کیفیت میانگین ترجمه ${faNumber(stats.translation_quality_percent, 1)}٪؛ میانگین درصد اهمیت اخبار ${faNumber(stats.avg_importance, 1)}٪.`,
    newCount ? `${faNumber(newCount)} خبر تازه (${faNumber(stats.new_since_last_percent, 1)}٪) از آخرین به‌روزرسانی اضافه شده است.` : 'خبر تازه‌ای نسبت به به‌روزرسانی قبلی اضافه نشده است.',
  ];

  // خروجی‌ها
  await writeJson(DATA_FILE, data);

  const xlsxRows = [
    ['ردیف', 'زمان انتشار', 'منبع', 'زبان', 'موضوعات', 'احساس', 'اهمیت٪', 'پوشش٪', 'تعداد منابع', 'منابع هم‌خبر', 'عنوان', 'ترجمه فارسی', 'خلاصه', 'خلاصه فارسی', 'لینک'],
    ...articles.map((article, index) => [
      index + 1,
      article.published,
      article.source_name,
      article.lang === 'fa' ? 'فارسی' : 'انگلیسی',
      article.topics.map((t) => t.name).join('، '),
      article.sentiment_label,
      article.importance,
      article.coverage_percent,
      article.source_count,
      (article.sources || []).join('، '),
      article.title,
      article.lang === 'en' ? article.title_fa : '',
      article.summary,
      article.lang === 'en' ? article.summary_fa : '',
      article.link,
    ]),
  ];

  const xlsx = buildXlsx([
    { name: 'اخبار', rows: xlsxRows, widths: [6, 22, 22, 9, 30, 8, 10, 9, 11, 35, 60, 60, 70, 70, 55] },
    {
      name: 'موضوعات',
      rows: [['موضوع', 'تعداد خبر', 'درصد از کل', 'احساس', 'روند یک‌ساعته', 'کلیدواژه‌ها'], ...topics.map((t) => [t.name, t.count, t.percent, t.sentiment, t.trend_percent ?? '—', t.top_keywords.join('، ')])],
      widths: [22, 12, 12, 10, 14, 55],
    },
    {
      name: 'بازار',
      rows: [
        ['کالا/ارز', 'قیمت', 'واحد', 'تغییر', 'تغییر٪', 'جهت', 'آخرین به‌روزرسانی', 'منبع'],
        ...markets.items.map((item) => [
          item.label,
          item.value,
          item.unit,
          item.change,
          item.change_percent,
          item.direction === 'up' ? 'افزایش' : item.direction === 'down' ? 'کاهش' : 'بدون تغییر',
          item.updated_at || '',
          item.source || markets.source || MARKET_SOURCE,
        ]),
      ],
      widths: [26, 16, 10, 14, 10, 12, 24, 12],
    },
    {
      name: 'منابع',
      rows: [['منبع', 'زبان', 'تعداد خبر', 'سهم٪', 'وضعیت', 'زمان پاسخ (میلی‌ثانیه)', 'خطا', 'نشانی'], ...sourceHealth.map((s) => [s.name, s.lang, s.count, s.percent, s.ok ? 'سالم' : 'خطا', s.elapsed_ms, s.error || '', s.url])],
      widths: [24, 9, 12, 10, 10, 18, 35, 55],
    },
    {
      name: 'تحلیل',
      rows: [['شاخص', 'مقدار', 'درصد', 'توضیح'], ...analysis.findings.map((f) => [f.title, typeof f.value === 'number' ? f.value : String(f.value), f.percent, f.detail]), ...analysis.alerts.map((a) => [`هشدار (${a.level})`, '', '', a.text])],
      widths: [42, 12, 12, 95],
    },
    { name: 'خلاصه', rows: [['خلاصهٔ اجرایی'], ...analysis.lines.map((line) => [line]), ...data.summary_lines.map((line) => [line])], widths: [120] },
  ]);

  await writeFile(XLSX_FILE, xlsx);

  // تاریخچهٔ اجراها برای محاسبهٔ روند
  const runRecord = {
    at: generatedAt,
    total: articles.length,
    sentiment: sentiment.score,
    topics: Object.fromEntries(topics.map((t) => [t.id, t.count])),
    sources: Object.fromEntries(sourceHealth.map((s) => [s.id, s.count])),
  };
  const runs = [...(history.runs || []), runRecord].slice(-288);
  await writeJson(HISTORY_FILE, { runs }, true);

  const nextSeen = {};
  for (const article of articles) {
    nextSeen[article.uid] = seenItems[article.uid] || generatedAt;
  }
  await writeJson(SEEN_FILE, { items: nextSeen });

  console.log(`✔ به‌روزرسانی کامل شد: ${stats.total} خبر، ${topics.length} موضوع، ${stories.length} قصه، ${stats.translation_coverage_percent}٪ ترجمه (${stats.run_ms}ms)`);
  return data;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  runPipeline().catch((error) => {
    console.error('✖ خطا در اجرای خط تولید:', error);
    process.exitCode = 1;
  });
}
