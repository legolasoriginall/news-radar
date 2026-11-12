// تست زنجیرهٔ منابع نرخ: عادی، دو منبع قطع، همه قطع
// اجرا: npm test  (بدون شبکه کار می‌کند؛ منابع ساختگی تزریق می‌شوند)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMarkets, computeDivergence, DIVERGENCE_THRESHOLD_PERCENT } from '../src/markets.mjs';

const IDS = ['dollar', 'euro', 'dirham', 'gold18', 'gold24', 'mesghal', 'coin', 'ounce'];

function makeItem(id, value) {
  return {
    id,
    label: id,
    group: 'currency',
    unit: 'تومان',
    value,
    change: 0,
    change_percent: 0,
    direction: 'flat',
    updated_at: '2026-11-12T12:00:00.000Z',
    stale: false,
  };
}

function fullSet(scale = 1) {
  return IDS.map((id, index) => makeItem(id, (1000 + index) * scale));
}

function okProvider(id, label, items) {
  return { id, label, load: async () => ({ items, feed: `${id}://feed` }) };
}

function failingProvider(id, label) {
  return {
    id,
    label,
    load: async () => {
      throw new Error('fetch failed');
    },
  };
}

test('سناریوی عادی: همهٔ نرخ‌ها از منبع اصلی', async () => {
  const result = await fetchMarkets({
    providers: [okProvider('tgju', 'TGJU', fullSet()), okProvider('nerkhara', 'نرخ‌آرا', fullSet())],
    globalProviders: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.items.length, IDS.length);
  assert.equal(result.previous_count, 0);
  assert.equal(result.source, 'TGJU');
  assert.ok(result.items.every((item) => item.source === 'TGJU'));
  assert.equal(result.warnings.length, 0);
});

test('سناریوی دو منبع قطع: نرخ‌ها از مرحلهٔ سوم می‌آیند', async () => {
  const result = await fetchMarkets({
    providers: [
      failingProvider('tgju', 'TGJU'),
      failingProvider('nerkhara', 'نرخ‌آرا'),
      okProvider('iranmarket', 'ایران‌مارکت', fullSet()),
    ],
    globalProviders: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.items.length, IDS.length);
  assert.equal(result.previous_count, 0);
  assert.equal(result.source, 'ایران‌مارکت');
  assert.ok(result.items.every((item) => item.source === 'ایران‌مارکت'));
  assert.match(result.error, /TGJU/);
  assert.match(result.error, /نرخ‌آرا/);
});

test('سناریوی همهٔ منابع قطع: آخرین مقدار موفق حفظ می‌شود', async () => {
  const previous = {
    items: fullSet().map((item) => ({ ...item, source: 'TGJU' })),
    generated_at: '2026-11-12T10:00:00.000Z',
  };
  const result = await fetchMarkets({
    providers: [
      failingProvider('tgju', 'TGJU'),
      failingProvider('nerkhara', 'نرخ‌آرا'),
      failingProvider('iranmarket', 'ایران‌مارکت'),
    ],
    globalProviders: [],
    previous,
  });

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.items.length, IDS.length);
  assert.equal(result.previous_count, IDS.length);
  assert.ok(result.items.every((item) => item.source === 'آخرین مقدار موفق' && item.stale === true));
  assert.match(result.error, /ایران‌مارکت/);
});

test('پوشش ناقص: نرخ‌های گم‌شده از مقدار قبلی تکمیل می‌شوند', async () => {
  const live = [makeItem('dollar', 111), makeItem('gold18', 222), makeItem('coin', 333)];
  const previous = { items: fullSet().map((item) => ({ ...item, source: 'TGJU' })) };
  const result = await fetchMarkets({
    providers: [okProvider('iranmarket', 'ایران‌مارکت', live)],
    globalProviders: [],
    previous,
  });

  assert.equal(result.ok, false);
  assert.equal(result.items.length, IDS.length);
  assert.equal(result.previous_count, IDS.length - live.length);
  const byId = new Map(result.items.map((item) => [item.id, item]));
  assert.equal(byId.get('dollar').source, 'ایران‌مارکت');
  assert.equal(byId.get('dollar').value, 111);
  assert.equal(byId.get('euro').source, 'آخرین مقدار موفق');
  assert.equal(byId.get('euro').stale, true);
});

test('هشدار اختلاف بیش از آستانه بین دو منبع', async () => {
  const base = fullSet();
  const divergent = fullSet();
  divergent[3] = makeItem('gold18', base[3].value * 1.05); // ۵٪ اختلاف

  const result = await fetchMarkets({
    providers: [okProvider('tgju', 'TGJU', base), okProvider('nerkhara', 'نرخ‌آرا', divergent)],
    globalProviders: [],
  });

  assert.equal(result.warnings.length, 1);
  const warning = result.warnings[0];
  assert.equal(warning.id, 'gold18');
  assert.equal(warning.threshold, DIVERGENCE_THRESHOLD_PERCENT);
  assert.ok(warning.percent > DIVERGENCE_THRESHOLD_PERCENT);
  assert.equal(warning.low.label, 'TGJU');
  assert.equal(warning.high.label, 'نرخ‌آرا');
});

test('اختلاف کمتر از آستانه هشدار نمی‌دهد ولی درصد را ثبت می‌کند', async () => {
  const base = fullSet();
  const close = fullSet();
  close[0] = makeItem('dollar', base[0].value * 1.02); // ۲٪

  const items = await fetchMarkets({
    providers: [okProvider('tgju', 'TGJU', base), okProvider('nerkhara', 'نرخ‌آرا', close)],
    globalProviders: [],
  });

  assert.equal(items.warnings.length, 0);
  const dollar = items.items.find((item) => item.id === 'dollar');
  assert.equal(dollar.divergence_percent, 2);
});

test('آشکارساز اختلاف برای یک منبع تنها کاری نمی‌کند', () => {
  const items = [makeItem('dollar', 1000)];
  const warnings = computeDivergence(items, [{ label: 'TGJU', ok: true, items: [makeItem('dollar', 1000)] }]);
  assert.equal(warnings.length, 0);
  assert.equal(items[0].divergence_percent, null);
});
