// تست تنظیم خوشه‌بندی قصه‌های چندمنبعی روی نمونه‌های واقعی‌مانند
import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterArticles } from '../src/analyze.mjs';

let counter = 0;
function makeArticle({ title, source = 's1', link, clusterTitle = '' }) {
  counter += 1;
  return {
    uid: `uid-${counter}`,
    source_id: source,
    source_name: source,
    lang: 'fa',
    title,
    title_fa: '',
    cluster_title: clusterTitle,
    link: link || `https://example.com/${counter}`,
    published: `2026-11-13T01:${String(counter % 60).padStart(2, '0')}:00.000Z`,
    topics: [{ name: 'بین‌الملل', score: 1 }],
    sentiment: 0,
    importance: 50,
  };
}

// زمینهٔ بزرگ تا وزن واژه‌های کمیاب مانند یک اجرای واقعی رفتار کند
const fillers = Array.from({ length: 200 }, (_, index) =>
  makeArticle({ title: `گزارش شمارهٔ ${index} دربارهٔ رویدادهای گوناگون جهان و بازارها`, source: `filler-${index}` })
);

test('دو خبر قالبی دربارهٔ دو شهر مختلف با هم یکی نمی‌شوند', () => {
  const tehran = makeArticle({ title: 'مراسم وداع با پیکر شهدای گمنام در میدان‌های تهران', source: 'isna' });
  const birjand = makeArticle({ title: 'مراسم وداع با پیکر شهدای گمنام در بیرجند', source: 'mehr' });
  const clusters = clusterArticles([...fillers, tehran, birjand]);
  const same = clusters.find((cluster) => cluster.members.some((member) => member.uid === tehran.uid));
  assert.ok(same);
  assert.equal(same.members.some((member) => member.uid === birjand.uid), false);
});

test('دو خبر دربارهٔ یک رویداد با نام مشترک یکی می‌شوند', () => {
  const first = makeArticle({
    title: 'کوشنر می‌گوید آمریکا برای بزرگ‌ترین تبادل اسرا در جنگ روسیه تلاش می‌کند',
    source: 'jpost',
  });
  const second = makeArticle({
    title: 'کوشنر: آمریکا در تلاش برای انجام بزرگ‌ترین تبادل زندانیان در جنگ روسیه',
    source: 'irna',
  });
  const clusters = clusterArticles([...fillers, first, second]);
  const same = clusters.find((cluster) => cluster.members.some((member) => member.uid === first.uid));
  assert.ok(same);
  assert.equal(same.members.some((member) => member.uid === second.uid), true);
});

test('عنوان‌های نامرتبط با واژه‌های عمومی یکی نمی‌شوند', () => {
  const first = makeArticle({ title: 'قیمت دلار امروز در بازار تهران کاهش یافت', source: 'donya' });
  const second = makeArticle({ title: 'قیمت سکه امروز در بازار تهران افزایش یافت', source: 'hamshahri' });
  const clusters = clusterArticles([...fillers, first, second]);
  const same = clusters.find((cluster) => cluster.members.some((member) => member.uid === first.uid));
  assert.ok(same);
  assert.equal(same.members.some((member) => member.uid === second.uid), false);
});

test('پست تلگرام با متن بلند به قصهٔ همان رویداد در خبرها وصل می‌شود', () => {
  const telegram = makeArticle({
    title: 'ترامپ گفت جنگ ایران می‌تواند پایان یابد',
    clusterTitle: 'ترامپ گفت جنگ ایران می‌تواند پایان یابد',
    source: 'iranintl_tv',
  });
  const site = makeArticle({ title: 'ترامپ: جنگ ایران پایان می‌یابد', source: 'khabaronline' });
  const clusters = clusterArticles([...fillers, telegram, site]);
  const same = clusters.find((cluster) => cluster.members.some((member) => member.uid === telegram.uid));
  assert.ok(same);
  assert.equal(same.members.some((member) => member.uid === site.uid), true);
});
