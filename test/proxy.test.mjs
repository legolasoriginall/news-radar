import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.mjs';

function fakeCache() {
  const store = new Map();
  return {
    async match(key) {
      const item = store.get(String(key));
      return item ? new Response(item.body, { status: item.status, headers: item.headers }) : undefined;
    },
    async put(key, response) {
      const body = await response.clone().text();
      store.set(String(key), {
        body,
        status: response.status,
        headers: Array.from(response.headers.entries()),
      });
    },
  };
}

function mediaResponse(url) {
  const response = new Response('segment-bytes', {
    status: 200,
    headers: { 'content-type': 'video/mp2t', 'content-length': '13' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

const target = 'https://media.example/seg.ts';
const proxyRequest = (extraHeaders = {}) =>
  new Request(`https://proxy.example/?url=${encodeURIComponent(target)}`, { headers: extraHeaders });

test('سگمنت رسانه‌ای در درخواست دوم از کش می‌آید', async () => {
  const cache = fakeCache();
  globalThis.caches = { open: async () => cache, default: cache };
  let fetched = 0;
  globalThis.fetch = async (url) => {
    fetched += 1;
    return mediaResponse(String(url));
  };

  const first = await worker.fetch(proxyRequest(), {}, {});
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-proxy-cache'), 'MISS');
  assert.equal(await first.text(), 'segment-bytes');

  const second = await worker.fetch(proxyRequest(), {}, {});
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-proxy-cache'), 'HIT');
  assert.equal(await second.text(), 'segment-bytes');
  assert.equal(fetched, 1);
});

test('درخواست Range از کش عبور نمی‌کند', async () => {
  const cache = fakeCache();
  globalThis.caches = { open: async () => cache, default: cache };
  let fetched = 0;
  globalThis.fetch = async (url) => {
    fetched += 1;
    const response = new Response('0123456789', {
      status: 206,
      headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-9/20', 'content-length': '10' },
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  };

  const response = await worker.fetch(proxyRequest({ range: 'bytes=0-9' }), {}, {});
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('x-proxy-cache'), 'OFF');
  assert.equal(fetched, 1);
});

test('هر IP پس از ۶۰۰ درخواست در دقیقه محدود می‌شود', async () => {
  const cache = fakeCache();
  globalThis.caches = { open: async () => cache, default: cache };
  globalThis.fetch = async () => {
    throw new Error('نباید برای آدرس نامعتبر به منبع وصل شود');
  };

  const request = (ip) =>
    new Request('https://proxy.example/?url=not-a-url', { headers: { 'cf-connecting-ip': ip } });

  for (let i = 0; i < 600; i += 1) {
    const response = await worker.fetch(request('203.0.113.7'), {}, {});
    assert.equal(response.status, 400);
  }
  const blocked = await worker.fetch(request('203.0.113.7'), {}, {});
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);

  const otherIp = await worker.fetch(request('203.0.113.8'), {}, {});
  assert.equal(otherIp.status, 400);
});
