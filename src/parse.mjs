// تحلیل‌گر ساده و بدون وابستگی خوراک‌های RSS/Atom

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  zwnj: '\u200c', zwj: '\u200d', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•',
  eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
  ccedil: 'ç', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  euro: '€', pound: '£', yen: '¥', cent: '¢', times: '×', divide: '÷',
};

export function decodeEntities(input = '') {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => {
      const key = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)) return NAMED_ENTITIES[key];
      return m;
    });
}

function safeChar(code) {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

export function stripHtml(input = '') {
  const text = String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

export function cleanText(input = '') {
  return decodeEntities(String(input))
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapTagValue(raw = '') {
  let value = raw.trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1];
  return value.trim();
}

function extractTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const m = block.match(re);
  return m ? unwrapTagValue(m[1]) : '';
}

function extractTagList(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(unwrapTagValue(m[1]));
  return out;
}

function extractLink(block) {
  const inner = extractTag(block, 'link');
  if (inner && !/<[a-z]/i.test(inner)) return cleanText(inner);
  const anchored = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  if (anchored) return decodeEntities(anchored[1]);
  const guid = extractTag(block, 'guid');
  if (guid && /^https?:/i.test(guid)) return decodeEntities(guid);
  const atomId = extractTag(block, 'id');
  if (atomId && /^https?:/i.test(atomId)) return decodeEntities(atomId);
  return '';
}

function parseDateVariants(values) {
  for (const value of values) {
    const raw = cleanText(value);
    if (!raw) continue;
    const ts = Date.parse(raw);
    if (Number.isFinite(ts) && ts > 0) return new Date(ts).toISOString();
  }
  return '';
}

export function parseFeed(xml, source) {
  const body = String(xml || '');
  const blocks = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
  let m;
  while ((m = itemRe.exec(body))) blocks.push(m[0]);
  if (!blocks.length) {
    while ((m = entryRe.exec(body))) blocks.push(m[0]);
  }

  const feedTitle = cleanText(extractTag(body.replace(/<item\b[\s\S]*$/i, ''), 'title'));
  const items = [];

  for (const block of blocks) {
    const title = cleanText(stripHtml(extractTag(block, 'title')));
    if (!title) continue;
    const link = extractLink(block);
    const summaryRaw =
      extractTag(block, 'description') ||
      extractTag(block, 'summary') ||
      extractTag(block, 'content:encoded') ||
      extractTag(block, 'content') ||
      '';
    const summary = stripHtml(summaryRaw).slice(0, 1400);
    const published = parseDateVariants([
      extractTag(block, 'pubDate'),
      extractTag(block, 'published'),
      extractTag(block, 'updated'),
      extractTag(block, 'dc:date'),
      extractTag(block, 'date'),
    ]);
    const author =
      cleanText(stripHtml(extractTag(block, 'author'))) ||
      cleanText(stripHtml(extractTag(block, 'dc:creator')));
    const categories = [
      ...extractTagList(block, 'category').map((c) => cleanText(stripHtml(c))).filter(Boolean),
      ...[...block.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?>/gi)].map((c) => decodeEntities(c[1])),
    ];

    items.push({
      title,
      link: link || '',
      summary,
      published,
      author: cleanText(author).slice(0, 160),
      categories: [...new Set(categories)].slice(0, 6),
      sourceId: source.id,
      sourceName: source.name,
      lang: source.lang,
      weight: source.weight,
      aggregator: Boolean(source.aggregator),
      defaultTopic: source.defaultTopic || '',
    });
  }

  const feedImage = (body.match(/<url>([^<]+)<\/url>/i) || [])[1] || '';
  return { title: feedTitle, items, feedImage };
}
