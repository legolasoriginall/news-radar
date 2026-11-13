// موتور تحلیل: موضوع‌بندی، احساس، کلیدواژه، اهمیت و خوشه‌بندی خبرهای تکراری

export const TOPICS = [
  {
    id: 'politics',
    name: 'سیاست',
    keywords: {
      fa: ['سیاست', 'دولت', 'مجلس', 'نماینده', 'وزیر', 'رئیس‌جمهور', 'انتخابات', 'حزب', 'کابینه', 'خارجه', 'مذاکره', 'توافق', 'قانون', 'شورای', 'دیپلمات', 'سفیر', 'تحریم', 'رهبر', 'سپاه', 'بسیج'],
      en: ['politics', 'government', 'president', 'senate', 'congress', 'election', 'minister', 'diplomat', 'policy', 'law', 'vote', 'parliament', 'white house', 'sanctions', 'talks', 'treaty'],
    },
  },
  {
    id: 'international',
    name: 'بین‌الملل',
    keywords: {
      fa: ['بین‌الملل', 'جهان', 'آمریکا', 'اروپا', 'روسیه', 'چین', 'اوکراین', 'غزه', 'اسرائیل', 'ترامپ', 'سازمان ملل', 'ناتو', 'ترکیه', 'عراق', 'افغانستان', 'سوریه', 'لبنان', 'اتحادیه اروپا'],
      en: ['world', 'international', 'united states', 'u.s.', 'america', 'europe', 'russia', 'china', 'ukraine', 'gaza', 'israel', 'trump', 'united nations', 'nato', 'turkey', 'iran', 'middle east'],
    },
  },
  {
    id: 'security',
    name: 'امنیت و دفاع',
    keywords: {
      fa: ['امنیت', 'دفاع', 'ارتش', 'نظامی', 'جنگ', 'موشک', 'حمله', 'نیرو', 'فرمانده', 'پدافند', 'پهپاد', 'رزمایش', 'تروریست', 'انفجار', 'سلاح', 'بازداشت', 'پلیس'],
      en: ['security', 'defense', 'military', 'army', 'war', 'missile', 'attack', 'troops', 'commander', 'drone', 'terror', 'explosion', 'weapon', 'police', 'strike', 'ceasefire'],
    },
  },
  {
    id: 'economy',
    name: 'اقتصاد',
    keywords: {
      fa: ['اقتصاد', 'بازار', 'قیمت', 'تورم', 'دلار', 'طلا', 'بورس', 'بانک', 'سرمایه‌گذاری', 'صادرات', 'واردات', 'بودجه', 'مالیات', 'تجارت', 'رشد اقتصادی', 'گرانی', 'یارانه', 'قرارداد'],
      en: ['economy', 'market', 'price', 'inflation', 'dollar', 'gold', 'stock', 'bank', 'investment', 'export', 'import', 'budget', 'tax', 'trade', 'tariff', 'growth', 'jobs', 'business'],
    },
  },
  {
    id: 'energy',
    name: 'انرژی',
    keywords: {
      fa: ['انرژی', 'نفت', 'گاز', 'برق', 'خاموشی', 'سوخت', 'پالایشگاه', 'اوپک', 'بهره‌برداری', 'خط لوله', 'هسته‌ای', 'سوخت‌رسانی'],
      en: ['energy', 'oil', 'gas', 'electricity', 'blackout', 'fuel', 'refinery', 'opec', 'pipeline', 'nuclear', 'power plant', 'renewable'],
    },
  },
  {
    id: 'tech',
    name: 'فناوری',
    keywords: {
      fa: ['فناوری', 'هوش مصنوعی', 'اینترنت', 'گوگل', 'اپل', 'مایکروسافت', 'نرم‌افزار', 'ربات', 'فضا', 'استارتاپ', 'دیجیتال', 'هک', 'داده', 'تراشه', 'موبایل', 'شبکه'],
      en: ['technology', 'tech', 'ai', 'artificial intelligence', 'internet', 'google', 'apple', 'microsoft', 'software', 'robot', 'space', 'startup', 'digital', 'hack', 'data', 'chip', 'mobile', 'cyber'],
    },
  },
  {
    id: 'society',
    name: 'اجتماعی',
    keywords: {
      fa: ['اجتماعی', 'مردم', 'شهر', 'آموزش', 'دانشگاه', 'بیمه', 'رفاه', 'مسکن', 'اجاره', 'اشتغال', 'مهاجرت', 'زنان', 'خانواده', 'حوادث', 'آتش‌نشانی', 'شهرداری'],
      en: ['society', 'people', 'city', 'education', 'university', 'insurance', 'housing', 'rent', 'migration', 'women', 'family', 'health care', 'welfare', 'community', 'court', 'protest'],
    },
  },
  {
    id: 'culture',
    name: 'فرهنگ و هنر',
    keywords: {
      fa: ['فرهنگ', 'هنر', 'هنرمند', 'سینما', 'فیلم', 'جشنواره', 'کتاب', 'موسیقی', 'نمایش', 'تلویزیون', 'بازیگر', 'کارگردان', 'شعر', 'موزه', 'تئاتر'],
      en: ['culture', 'art', 'artist', 'cinema', 'film', 'festival', 'book', 'music', 'theater', 'movie', 'actor', 'director', 'museum', 'award', 'oscar'],
    },
  },
  {
    id: 'sports',
    name: 'ورزش',
    keywords: {
      fa: ['ورزش', 'فوتبال', 'بازی', 'تیم', 'لیگ', 'فوتسال', 'کشتی', 'المپیک', 'مربی', 'بازیکن', 'قهرمانی', 'والیبال', 'بسکتبال', 'دربی'],
      en: ['sport', 'football', 'soccer', 'game', 'team', 'league', 'coach', 'player', 'championship', 'olympic', 'basketball', 'tennis', 'match'],
    },
  },
  {
    id: 'health',
    name: 'سلامت',
    keywords: {
      fa: ['سلامت', 'درمان', 'بیماری', 'دارو', 'بیمارستان', 'واکسن', 'پزشک', 'کرونا', 'آنفلوآنزا', 'تغذیه', 'دیابت', 'سرطان', 'عفونت'],
      en: ['health', 'treatment', 'disease', 'drug', 'hospital', 'vaccine', 'doctor', 'covid', 'flu', 'nutrition', 'cancer', 'infection', 'medicine'],
    },
  },
  {
    id: 'science',
    name: 'علم و دانش',
    keywords: {
      fa: ['علم', 'دانش', 'پژوهش', 'تحقیق', 'کشف', 'دانشمند', 'فیزیک', 'شیمی', 'زیست', 'نجوم', 'سیاره', 'کهکشان', 'مطالعه', 'آزمایش'],
      en: ['science', 'research', 'study', 'discovery', 'scientist', 'physics', 'chemistry', 'biology', 'astronomy', 'planet', 'galaxy', 'experiment', 'nasa'],
    },
  },
  {
    id: 'environment',
    name: 'محیط زیست',
    keywords: {
      fa: ['محیط زیست', 'آلودگی', 'هوا', 'آب', 'خشکسالی', 'زلزله', 'سیل', 'گرمایش', 'اقلیم', 'پسماند', 'دریا', 'جنگل', 'حیات وحش'],
      en: ['environment', 'pollution', 'air quality', 'water', 'drought', 'earthquake', 'flood', 'warming', 'climate', 'waste', 'wildfire', 'ocean', 'species'],
    },
  },
];

const FA_STOPWORDS = new Set([
  'و', 'در', 'به', 'از', 'که', 'این', 'را', 'با', 'برای', 'است', 'می', 'شود', 'شد', 'شده', 'های', 'ها', 'یک', 'تا', 'هم',
  'بر', 'بود', 'او', 'آن', 'خود', 'کرد', 'کند', 'کنند', 'کنید', 'باید', 'درباره', 'بین', 'پس', 'پیش', 'نیز', 'همه', 'هر',
  'دو', 'سه', 'چه', 'اگر', 'اما', 'یا', 'بدون', 'روی', 'عنوان', 'طی', 'سوی', 'مقابل', 'ضمن', 'افزود', 'گفت', 'اعلام',
  'وی', 'ما', 'شما', 'آنها', 'ایشان', 'چند', 'دیگر', 'بسیار', 'بیشتر', 'کمتر', 'حتی', 'فقط', 'چون', 'زیرا', 'بنابراین',
  'امروز', 'دیروز', 'فردا', 'هفته', 'ماه', 'سال', 'روز', 'ساعت', 'دقیقه', 'گزارش', 'خبر', 'اخبار', 'منتشر', 'منبع',
  'عکس', 'فیلم', 'ویدیو', 'جدید', 'اخیر', 'اولین', 'آخرین', 'ویژه', 'کامل', 'مهم', 'اصلی', 'نشان', 'می‌دهد', 'کرده',
  'کردند', 'می‌کند', 'می‌شود', 'نمی', 'هست', 'هستند', 'نیست', 'بوده', 'باشند', 'دارد', 'دارند', 'داشت', 'ندارد',
]);

const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'of', 'to', 'in', 'on',
  'for', 'with', 'without', 'from', 'by', 'at', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its',
  'he', 'she', 'they', 'them', 'his', 'her', 'their', 'we', 'our', 'you', 'your', 'i', 'me', 'my', 'not', 'no', 'yes',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'about',
  'after', 'before', 'over', 'under', 'into', 'out', 'up', 'down', 'more', 'most', 'less', 'least', 'new', 'news', 'say',
  'says', 'said', 'one', 'two', 'three', 'just', 'also', 'how', 'why', 'what', 'when', 'where', 'who', 'which', 'there',
  'here', 'now', 'today', 'yesterday', 'week', 'month', 'year', 'day', 'first', 'last', 'live', 'update', 'breaking',
  'video', 'photo', 'report', 'reports', 'according', 'amid', 'via', 'get', 'gets', 'got', 'make', 'makes', 'made',
]);

const POSITIVE = {
  fa: { پیشرفت: 1, موفق: 1.2, موفقیت: 1.2, افزایش: 0.7, رشد: 0.9, توافق: 1.1, افتتاح: 0.9, رونمایی: 0.7, دستاورد: 1.2, بهبود: 1.1, امیدوار: 1, پیروزی: 1.2, صلح: 1.3, آزادی: 0.9, حمایت: 0.7, تقدیر: 0.9, برنده: 1, رکورد: 0.8, درمان: 0.9, کشف: 0.8, سرمایه‌گذاری: 0.6, اشتغال: 0.7, صادرات: 0.5, رونق: 1, احیا: 0.8, نجات: 1, همکاری: 0.7, گشایش: 0.8, بهره‌برداری: 0.6, جهش: 0.8, ارتقا: 0.7, اعتماد: 0.6 },
  en: { success: 1.2, growth: 0.9, gain: 0.8, gains: 0.8, win: 1.1, wins: 1.1, breakthrough: 1.2, deal: 1, agreement: 1.1, peace: 1.3, recover: 0.9, recovery: 0.9, boost: 1, improve: 0.9, improvement: 1, record: 0.7, rise: 0.7, rises: 0.7, surge: 0.8, profit: 0.8, aid: 0.6, rescue: 1, hope: 0.7, celebrate: 0.9, launch: 0.6, discovery: 0.8, approve: 0.7, elected: 0.7, reopen: 0.8, truce: 1, ceasefire: 1.1, support: 0.6 },
};

const NEGATIVE = {
  fa: { جنگ: -1.3, حمله: -1.2, کشته: -1.4, زخمی: -1.2, بحران: -1.3, هشدار: -0.9, تهدید: -1.1, تحریم: -1, کاهش: -0.7, افت: -0.8, سقوط: -1.1, اعتراض: -0.9, بازداشت: -1.1, فساد: -1.2, تخریب: -1.1, آتش‌سوزی: -1.2, مرگ: -1.5, فوت: -1.3, شکست: -1.1, تنش: -1, خطر: -1, آلودگی: -1, گرانی: -0.9, تورم: -0.8, بدهی: -0.7, ورشکستگی: -1.3, محکومیت: -1, اخراج: -0.9, اعتصاب: -0.8, زلزله: -1.2, سیل: -1.2, خشکسالی: -1, قتل: -1.5, انفجار: -1.2, آوار: -1.1, مصدوم: -0.8, خسارت: -0.9, بیکاری: -1, گرانی: -0.9, قطع: -0.7 },
  en: { war: -1.3, attack: -1.2, attacks: -1.2, killed: -1.4, kill: -1.3, deaths: -1.4, dead: -1.4, injured: -1.2, crisis: -1.3, warning: -0.9, threat: -1.1, threatens: -1.1, sanctions: -1, fall: -0.9, falls: -0.9, drop: -0.8, crash: -1.2, protest: -0.9, arrested: -1.1, corruption: -1.2, destroyed: -1.2, fire: -1.1, death: -1.4, died: -1.4, defeat: -1.1, tension: -1, risk: -0.9, pollution: -1, inflation: -0.8, debt: -0.7, bankruptcy: -1.3, convicted: -1, strike: -0.8, earthquake: -1.2, flood: -1.2, drought: -1, murder: -1.5, explosion: -1.2, damage: -0.9, unemployment: -1, shortage: -0.9, collapse: -1.2, wounded: -1.1 },
};

const NEGATIONS_FA = ['نه', 'بدون', 'نمی', 'هیچ', 'هرگز'];
const NEGATIONS_EN = ['not', 'no', 'never', 'without', "n't", 'hardly'];

const VOWELS = /[\u064B-\u0652\u0670\u0640]/g;
const ARABIC_MAP = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'ؤ': 'و', 'ئ': 'ی' };

export function normalizeFa(text = '') {
  return String(text)
    .replace(VOWELS, '')
    .replace(/[يىكأةۀأإؤئ]/g, (c) => ARABIC_MAP[c] || c)
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u200c/g, ' ')
    .replace(/[«»"'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(text = '') {
  return normalizeFa(String(text).toLowerCase())
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text = '', lang = 'fa') {
  const norm = lang === 'en' ? String(text).toLowerCase() : normalizeFa(String(text).toLowerCase());
  const words = norm.match(/[\p{L}\p{N}][\p{L}\p{N}\-']*/gu) || [];
  const stop = lang === 'en' ? EN_STOPWORDS : FA_STOPWORDS;
  return words.filter((w) => w.length > 2 && !stop.has(w));
}

function countMatches(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

export function detectTopics(title, summary, lang, defaultTopic) {
  const titleText = lang === 'en' ? String(title).toLowerCase() : normalizeFa(String(title).toLowerCase());
  const summaryText = lang === 'en' ? String(summary || '').toLowerCase() : normalizeFa(String(summary || '').toLowerCase());
  const scored = [];

  for (const topic of TOPICS) {
    const words = lang === 'en' ? topic.keywords.en : topic.keywords.fa;
    let score = 0;
    for (const word of words) {
      const w = lang === 'en' ? word.toLowerCase() : normalizeFa(word.toLowerCase());
      const weight = w.includes(' ') ? 1.6 : 1;
      score += (countMatches(titleText, w) * 2.2 + countMatches(summaryText, w)) * weight;
    }
    if (score > 0) scored.push({ id: topic.id, name: topic.name, score });
  }

  if (!scored.length && defaultTopic) {
    const topic = TOPICS.find((t) => t.id === defaultTopic);
    if (topic) scored.push({ id: topic.id, name: topic.name, score: 0.9 });
  }
  if (!scored.length) {
    const fallback = lang === 'en' ? 'international' : 'society';
    const topic = TOPICS.find((t) => t.id === fallback);
    scored.push({ id: fallback, name: topic.name, score: 0.4 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((t) => ({ ...t, score: Number(t.score.toFixed(2)) }));
}

export function analyzeSentiment(title, summary, lang) {
  const lexicon = lang === 'en' ? { pos: POSITIVE.en, neg: NEGATIVE.en } : { pos: POSITIVE.fa, neg: NEGATIVE.fa };
  const negations = lang === 'en' ? NEGATIONS_EN : NEGATIONS_FA;
  const text = `${title} ${title} ${summary || ''}`;
  const words = (lang === 'en' ? String(text).toLowerCase() : normalizeFa(String(text).toLowerCase()))
    .match(/[\p{L}\p{N}][\p{L}\p{N}\-']*/gu) || [];

  let score = 0;
  let hits = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let value = lexicon.pos[w] || lexicon.neg[w] || 0;
    if (!value) continue;
    const windowStart = Math.max(0, i - 3);
    const negated = words.slice(windowStart, i).some((prev) => negations.includes(prev));
    if (negated) value *= -0.85;
    score += value;
    hits += 1;
  }

  const normalized = hits ? Math.max(-1, Math.min(1, score / (hits * 1.25))) : 0;
  const rounded = Number(normalized.toFixed(3));
  const label = rounded > 0.12 ? 'مثبت' : rounded < -0.12 ? 'منفی' : 'خنثی';
  return { score: rounded, label, hits };
}

export function extractKeywords(title, summary, lang, limit = 6) {
  const titleTokens = tokenize(title, lang);
  const summaryTokens = tokenize(summary, lang).slice(0, 60);
  const weights = new Map();
  for (const token of titleTokens) weights.set(token, (weights.get(token) || 0) + 3);
  for (const token of summaryTokens) weights.set(token, (weights.get(token) || 0) + 1);
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

export function clusterArticles(articles) {
  const clusters = [];
  const tokenCache = new Map();
  // عنوان فارسی خبرهای ترجمه‌شده مبنای خوشه‌بندی قرار می‌گیرد تا خبر فارسی و انگلیسی یک رویداد به هم متصل شوند
  const getTokens = (article) => {
    if (!tokenCache.has(article.uid)) {
      const useFa = Boolean(article.title_fa);
      // برخی منابع (مثل پست‌های تلگرام) متن بلند دارند؛ عنوان خوشه‌بندی کوتاه‌تری داشته باشند
      const text = article.cluster_title || (useFa ? article.title_fa : article.title);
      const lang = article.cluster_title ? article.lang : useFa ? 'fa' : article.lang;
      tokenCache.set(article.uid, {
        lang,
        signature: Boolean(article.cluster_title),
        tokens: new Set(tokenize(text, lang).filter((t) => t.length > 2)),
      });
    }
    return tokenCache.get(article.uid);
  };

  const sorted = [...articles].sort((a, b) => new Date(b.published) - new Date(a.published));
  for (const article of sorted) {
    const info = getTokens(article);
    let target = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      if (cluster.linkSet.has(article.link)) {
        target = cluster;
        bestScore = 1;
        break;
      }
      const anchor = getTokens(cluster.representative);
      if (anchor.lang !== info.lang) continue;
      // متن بلند (پست تلگرام) با عنوان کوتاه با «پوشش واژه‌ها» سنجیده می‌شود تا به قصهٔ همان رویداد وصل شود
      const byCoverage = info.signature || anchor.signature;
      const score = byCoverage ? overlapScore(info.tokens, anchor.tokens) : jaccard(info.tokens, anchor.tokens);
      if (score > bestScore && score >= (byCoverage ? 0.65 : 0.5)) {
        bestScore = score;
        target = cluster;
      }
    }
    if (target) {
      target.members.push(article);
      target.linkSet.add(article.link);
      if (article.title.length > target.representative.title.length) {
        target.representative = article;
      }
    } else {
      clusters.push({
        lang: info.lang,
        representative: article,
        members: [article],
        linkSet: new Set([article.link]),
      });
    }
  }
  return clusters;
}

function overlapScore(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function buildStories(clusters, totalArticles) {
  const stories = clusters
    .filter((cluster) => cluster.members.length > 0)
    .map((cluster) => {
      const members = [...cluster.members].sort((a, b) => (b.importance || 0) - (a.importance || 0));
      const primary = members[0];
      const sources = uniqueBy(members.map((m) => ({ id: m.source_id, name: m.source_name, url: m.link })), 'id');
      const maxPublished = members.reduce((acc, m) => (new Date(m.published) > new Date(acc) ? m.published : acc), members[0].published);
      return {
        title: primary.title_fa || primary.title,
        title_original: primary.title,
        title_fa: primary.title_fa || '',
        url: primary.link,
        lang: primary.lang,
        primary_source: primary.source_name,
        primary_source_id: primary.source_id,
        members_count: members.length,
        source_count: sources.length,
        sources: sources.slice(0, 8),
        importance: Number(Math.max(...members.map((m) => m.importance || 0)).toFixed(1)),
        published: maxPublished,
        topics: primary.topics.map((t) => t.name),
        sentiment: Number((members.reduce((a, m) => a + m.sentiment, 0) / members.length).toFixed(3)),
      };
    })
    .sort((a, b) => b.members_count - a.members_count || b.importance - a.importance);

  const topMembers = stories.length ? Math.max(...stories.map((s) => s.members_count)) : 1;
  for (const story of stories) {
    story.coverage_percent = Number(((story.members_count / topMembers) * 100).toFixed(1));
    story.share_percent = Number(((story.members_count / Math.max(1, totalArticles)) * 100).toFixed(1));
    story.multi_source = story.source_count > 1;
    story.multi_source_percent = Number(((story.source_count / Math.max(1, stories.length)) * 100).toFixed(1));
  }
  return stories;
}

export function uniqueBy(list, key) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const value = item[key];
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(item);
  }
  return out;
}

// درجات اهمیت (مجموع ۱۰۰) — برای نمایش درصدی در داشبورد
export function computeImportance({ ageHours, sourceWeight, clusterSize, topicScore, sentimentScore }) {
  const recency = 30 * Math.exp((-Math.max(0, ageHours) / 48) * Math.LN2);
  const source = Math.max(0, Math.min(1, sourceWeight)) * 20;
  const coverage = Math.min(1, Math.max(0, clusterSize - 1) / 4) * 25;
  const topic = Math.min(1, topicScore / 7) * 15;
  const sentiment = Math.min(1, Math.abs(sentimentScore)) * 10;
  const total = recency + source + coverage + topic + sentiment;
  return {
    total: Number(total.toFixed(1)),
    breakdown: {
      recency: Number(recency.toFixed(1)),
      source: Number(source.toFixed(1)),
      coverage: Number(coverage.toFixed(1)),
      topic: Number(topic.toFixed(1)),
      sentiment: Number(sentiment.toFixed(1)),
    },
  };
}
