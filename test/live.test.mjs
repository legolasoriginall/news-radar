import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylist, selectSources, probeStream, resolveLiveChannels } from '../src/live.mjs';

const channel = {
  id: 'iranintl',
  name: 'ایران اینترنشنال',
  tvg_ids: ['iraninternational.uk'],
  watch: 'https://www.iranintl.com/live',
  fallbacks: ['https://fallback.example/stream.m3u8'],
};

test('parsePlaylist رکوردهای EXTINF را با نشانی می‌خواند', () => {
  const m3u = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="IranInternational.uk@SD" group-title="News",Iran International',
    'https://cdn.example/iran.m3u8',
    '#EXTINF:-1 tvg-id="Other.us@SD",Other',
    'https://cdn.example/other.mpd',
  ].join('\n');

  const items = parsePlaylist(m3u);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    tvgId: 'IranInternational.uk@SD',
    name: 'Iran International',
    url: 'https://cdn.example/iran.m3u8',
  });
});

test('selectSources فقط HLS همان کانال را بدون تکرار برمی‌گرداند', () => {
  const entries = [
    { tvgId: 'IranInternational.uk@HD', name: 'a', url: 'https://cdn.example/one.m3u8' },
    { tvgId: 'iraninternational.uk', name: 'b', url: 'https://cdn.example/one.m3u8' },
    { tvgId: 'IranInternational.uk', name: 'c', url: 'https://cdn.example/dash.mpd' },
    { tvgId: 'Other.uk', name: 'd', url: 'https://cdn.example/other.m3u8' },
    { tvgId: 'IranInternational.uk', name: 'e', url: 'https://cdn.example/two.m3u8?token=1' },
  ];

  assert.deepEqual(selectSources(entries, channel), [
    'https://cdn.example/one.m3u8',
    'https://cdn.example/two.m3u8?token=1',
  ]);
});

test('probeStream فقط پاسخ سالم HLS را قبول می‌کند', async () => {
  const okFetcher = async () => ({ ok: true, text: async () => '#EXTM3U\n#EXT-X-VERSION:3' });
  const badStatus = async () => ({ ok: false, text: async () => '#EXTM3U' });
  const notHls = async () => ({ ok: true, text: async () => '<html>403</html>' });
  const throws = async () => { throw new Error('blocked'); };

  assert.equal(await probeStream('https://x/stream.m3u8', { fetcher: okFetcher }), true);
  assert.equal(await probeStream('https://x/stream.m3u8', { fetcher: badStatus }), false);
  assert.equal(await probeStream('https://x/stream.m3u8', { fetcher: notHls }), false);
  assert.equal(await probeStream('https://x/stream.m3u8', { fetcher: throws }), false);
});

test('resolveLiveChannels منابع سالم را اول می‌گذارد و خطای فهرست را تحمل می‌کند', async () => {
  const playlist = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="IranInternational.uk@SD",Iran International',
    'https://dead.example/stream.m3u8',
    '#EXTINF:-1 tvg-id="IranInternational.uk@SD",Iran International',
    'https://alive.example/stream.m3u8',
  ].join('\n');

  const fetcher = async (url) => {
    if (url === 'https://playlist.example/fas.m3u') return { ok: true, text: async () => playlist };
    if (url.startsWith('https://dead.example')) return { ok: false, text: async () => '' };
    if (url.startsWith('https://alive.example')) return { ok: true, text: async () => '#EXTM3U' };
    return { ok: true, text: async () => '#EXTM3U' };
  };

  const resolved = await resolveLiveChannels({
    channels: [channel],
    playlists: ['https://playlist.example/fas.m3u', 'https://broken.example/index.m3u'],
    fetcher,
    timeoutMs: 1000,
  });

  assert.equal(resolved.channels.length, 1);
  assert.deepEqual(resolved.channels[0].sources, [
    'https://alive.example/stream.m3u8',
    'https://fallback.example/stream.m3u8',
  ]);

  const offline = await resolveLiveChannels({
    channels: [channel],
    playlists: ['https://broken.example/index.m3u'],
    fetcher: async (url) => {
      if (url === 'https://broken.example/index.m3u') return { ok: false, text: async () => '' };
      return { ok: false, text: async () => '' };
    },
    timeoutMs: 1000,
  });
  assert.deepEqual(offline.channels[0].sources, ['https://fallback.example/stream.m3u8']);
});
