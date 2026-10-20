// 4.3 的自检：网易云的字段映射、日推的两级退让、降级链的"档位 × 源"顺序、本地兜底。
// 全程零联网：喂一个按路径分发的假 fetch 就够了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNeteaseSource } from '../../core/music/netease.ts';
import { createLocalSource } from '../../core/music/local.ts';
import { createMusicSourceChain, LEVELS } from '../../core/music/index.ts';
import { HttpError } from '../../core/http.ts';

const NOWHERE = 'http://music.test';
const COOKIE = 'MUSIC_U=abc; __csrf=xyz';

const routes = (map) => {
  const calls = [];
  const fetch = async (request) => {
    calls.push({ url: request.url, headers: request.headers });
    const path = new URL(request.url).pathname;
    const handler = map[path];
    if (handler === undefined) return { status: 404, text: async () => '{"code":404}', bytes: async () => new Uint8Array(), };
    const result = typeof handler === 'function' ? handler(request) : handler;
    if (result instanceof Error) throw result;
    return { status: result.status ?? 200, text: async () => JSON.stringify(result.body ?? result), bytes: async () => new Uint8Array(), };
  };
  return { fetch, calls };
};

const song = (id, name, artist) => ({ id, name, ar: [{ name: artist }], al: { name: 'Album', picUrl: 'http://cover/' + id + '.jpg' }, dt: 187000 });

test('网易云：字段映射、cookie 只走请求头', async () => {
  const { fetch, calls } = routes({
    '/cloudsearch': { body: { result: { songs: [song(1001, 'Midnight Drive', 'The Long Way')] } } },
  });
  const source = createNeteaseSource({ baseUrl: NOWHERE, cookie: COOKIE, fetch });
  const tracks = await source.search('midnight', 5);

  assert.deepEqual(tracks, [{
    id: '1001', title: 'Midnight Drive', artist: 'The Long Way', album: 'Album',
    coverUrl: 'http://cover/1001.jpg', durationMs: 187000, source: 'netease',
  }]);
  assert.match(calls[0].url, /\/cloudsearch\?keywords=midnight&limit=5$/);
  assert.equal(calls[0].headers.cookie, COOKIE);
  assert.equal(tracks[0].source, 'netease');
});

test('网易云 recommend：有场景词走搜索；没有才走日推，日推不行再退到公开接口', async () => {
  const { fetch, calls } = routes({
    '/cloudsearch': { body: { result: { songs: [song(1001, 'Midnight Drive', 'The Long Way')] } } },
    '/recommend/songs': { body: { data: { dailySongs: [song(1002, 'Neon Hours', 'Kite & Ash')] } } },
    '/personalized/newsong': { body: { result: [{ song: song(1003, 'Slow Static', 'Marina Vale') }] } },
  });
  const source = createNeteaseSource({ baseUrl: NOWHERE, fetch });

  const byScene = await source.recommend({ genres: ['ambient'], mood: 'low and steady' }, 3);
  assert.deepEqual(byScene.map((t) => t.title), ['Midnight Drive'], '场景词必须走搜索，日推听不懂"慢一点"');
  assert.equal(new URL(calls[0].url).pathname, '/cloudsearch');

  const byDaily = await source.recommend({}, 3);
  assert.deepEqual(byDaily.map((t) => t.title), ['Neon Hours']);

  // 日推需要登录：cookie 过期 / 没配时它会失败，此时必须退到公开接口，而不是把电台停掉。
  const noLogin = createNeteaseSource({
    baseUrl: NOWHERE,
    fetch: routes({
      '/recommend/songs': { status: 301, body: { code: 301 } },
      '/personalized/newsong': { body: { result: [{ song: song(1003, 'Slow Static', 'Marina Vale') }] } },
    }).fetch,
  });
  assert.deepEqual((await noLogin.recommend({}, 3)).map((t) => t.title), ['Slow Static'], '要认 song 嵌套的那一层');
});

test('网易云 resolve：只试一个档位；拿不到返回 null，不是抛错', async () => {
  const { fetch, calls } = routes({
    '/song/url/v1': { body: { data: [{ url: 'http://audio/1.mp3', level: 'exhigh' }] } },
  });
  const source = createNeteaseSource({ baseUrl: NOWHERE, fetch });
  assert.deepEqual(await source.resolve('1001', 'exhigh'), { url: 'http://audio/1.mp3', level: 'exhigh' });
  assert.match(calls[0].url, /level=exhigh$/);

  const empty = createNeteaseSource({ baseUrl: NOWHERE, fetch: routes({ '/song/url/v1': { body: { data: [{ url: null }] } } }).fetch });
  assert.equal(await empty.resolve('1001', 'exhigh'), null, '版权拿不到 = null，让链去降级');

  // 试听片段（freeTrialInfo 有值）：url 是有的，但只覆盖前 30 秒。放它过去，
  // UI 就会把 30 秒当成整曲 —— 进度条瞬间拉满、末尾写死 0:30 / 0:30。
  const trial = createNeteaseSource({
    baseUrl: NOWHERE,
    fetch: routes({ '/song/url/v1': { body: { data: [{ url: 'http://audio/clip.mp3', level: 'standard', freeTrialInfo: { start: 0, end: 30 } }] } } }).fetch,
  });
  assert.equal(await trial.resolve('64093', 'lossless'), null, '试听片段也算「拿不到整曲」，交回链');

  const broken = createNeteaseSource({ baseUrl: NOWHERE, fetch: routes({ '/song/url/v1': { status: 502, body: { code: 502 } } }).fetch });
  await assert.rejects(() => broken.resolve('1001', 'exhigh'), (error) => error instanceof HttpError && error.status === 502);
});

const source = (id, overrides = {}) => ({
  id,
  recommend: async () => [],
  search: async () => [],
  resolve: async () => null,
  ...overrides,
});

test('链：一个源抛错就换下一个；全空给空数组，不抛错', async () => {
  const chain = createMusicSourceChain([
    source('broken', { recommend: async () => { throw new Error('music source unreachable'); } }),
    source('ok', { recommend: async (_seed, limit) => [{ id: 'n1', title: 'T', artist: 'A', source: 'ok' }].slice(0, limit) }),
  ]);
  assert.deepEqual((await chain.recommend({}, 5)).map((t) => t.id), ['n1']);

  const empty = createMusicSourceChain([source('a'), source('b')]);
  assert.deepEqual(await empty.recommend({}, 5), []);
  assert.deepEqual(await empty.search('x', 5), []);
  assert.equal(await empty.resolve('n1', 'lossless'), null);
  assert.equal(empty.id, 'chain');
});

test('链 resolve：从请求的那一档往下试，档位 × 源 是笛卡尔积', async () => {
  const attempts = [];
  const picky = source('picky', {
    resolve: async (songId, level) => {
      attempts.push(level);
      return level === 'standard' ? { url: 'http://audio/low.mp3', level: 'standard' } : null;
    },
  });
  const chain = createMusicSourceChain([picky]);
  assert.deepEqual(await chain.resolve('n1', 'lossless'), { url: 'http://audio/low.mp3', level: 'standard' });
  assert.deepEqual(attempts, [...LEVELS], 'lossless → exhigh → higher → standard，逐档往下');

  // 请求 standard 时不该去试更高的档：那是白花的两次请求。
  attempts.length = 0;
  await createMusicSourceChain([picky]).resolve('n1', 'standard');
  assert.deepEqual(attempts, ['standard']);

  // 一个源抛错不影响另一个源在同一档上成功。
  const flaky = source('flaky', { resolve: async () => { throw new Error('boom'); } });
  const later = source('later', { resolve: async () => ({ url: 'http://audio/ok.mp3', level: 'lossless' }) });
  assert.deepEqual(await createMusicSourceChain([flaky, later]).resolve('n1', 'lossless'), { url: 'http://audio/ok.mp3', level: 'lossless' });
});

test('本地兜底：文件名就是元数据，resolve 给 file:// 地址；没有目录只是没歌', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edgerunner-'));
  writeFileSync(join(dir, 'Marina Vale - Slow Static.mp3'), 'x');
  writeFileSync(join(dir, 'notes.txt'), 'x');
  writeFileSync(join(dir, 'Untitled.flac'), 'x');

  const local = createLocalSource({ dir });
  const all = await local.recommend({}, 10);
  assert.deepEqual(all.map((t) => [t.title, t.artist]), [['Slow Static', 'Marina Vale'], ['Untitled', 'Local Files']], '按文件名排序（M 在 U 前）');
  assert.deepEqual(all.map((t) => t.source), ['local', 'local']);

  assert.deepEqual((await local.search('marina', 10)).map((t) => t.title), ['Slow Static']);
  assert.deepEqual((await local.search('zzz', 10)).map((t) => t.title), ['Slow Static', 'Untitled'], '一个字没匹配上就给全部：兜底不许哑掉');

  const audio = await local.resolve('local:Untitled.flac', 'exhigh');
  assert.equal(audio.level, 'exhigh', '本地文件没有档位可言，照请求的那一档回');
  assert.match(audio.url, /^file:\/\/\/.*Untitled\.flac$/);
  assert.equal(await local.resolve('netease:1001', 'exhigh'), null);
  assert.equal(await local.resolve('local:nope.mp3', 'exhigh'), null);

  const missing = createLocalSource({ dir: join(dir, 'not-here') });
  assert.deepEqual(await missing.recommend({}, 5), []);
  assert.equal(await missing.resolve('local:x.mp3', 'standard'), null);
});

test('网易云 library：cookie → 我是谁 → 我的歌单（曲目多的先取）→ 歌单里的歌', async () => {
  const { fetch, calls } = routes({
    '/user/account': { body: { profile: { userId: 42 } } },
    '/user/playlist': { body: { playlist: [
      { id: 7, name: 'Rainy', trackCount: 2 },
      { id: 9, name: 'Loud', trackCount: 40 },
    ] } },
    '/playlist/track/all': (request) => ({
      body: { songs: new URL(request.url).searchParams.get('id') === '9'
        ? [song(2001, 'Neon Hours', 'Kite & Ash')]
        : [song(2002, 'Slow Static', 'Marina Vale')] },
    }),
  });
  const source = createNeteaseSource({ baseUrl: NOWHERE, cookie: COOKIE, fetch });
  const tracks = await source.library(10);

  assert.deepEqual(tracks.map((t) => t.id), ['2001', '2002'], '曲目多的歌单先取');
  assert.equal(new URL(calls[1].url).pathname, '/user/playlist');
  assert.match(calls[1].url, /uid=42/);
  assert.equal(calls[1].headers.cookie, COOKIE, 'cookie 只走请求头');
});

test('网易云 library：拿不到「我是谁」就回空数组，不抛错（没 cookie 是常态）', async () => {
  const { fetch } = routes({ '/user/account': { body: { code: 301 } } });
  const source = createNeteaseSource({ baseUrl: NOWHERE, fetch });
  assert.deepEqual(await source.library(10), []);
});

test('链的 library 与其它方法同一套：主的空就换下一个源', async () => {
  const bare = (id, shelf) => ({
    id, recommend: async () => [], search: async () => [], resolve: async () => null, library: async () => shelf,
  });
  const chain = createMusicSourceChain([bare('a', []), bare('b', [{ id: 'l1', title: 'X', artist: 'Y', source: 'b' }])]);
  assert.deepEqual((await chain.library(5)).map((t) => t.id), ['l1']);
});

test('本地源的曲库就是目录里所有的音频文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-local-'));
  writeFileSync(join(dir, 'The Long Way - Midnight Drive.mp3'), 'x');
  writeFileSync(join(dir, 'notes.txt'), 'x');
  const tracks = await createLocalSource({ dir }).library(10);
  assert.deepEqual(tracks.map((t) => t.title), ['Midnight Drive'], '非音频文件不算');
  assert.equal(tracks[0].artist, 'The Long Way');
});
