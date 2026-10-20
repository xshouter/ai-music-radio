// 4.5 的自检：电台状态机（core/radio.ts）与 HTTP/WS 翻译层（core/server.ts）。
// 全程零联网：一个按路径分发的假 fetch。存储用真 node:sqlite 的内存库 ——
// 顺带证明 core/ 确实不认识驱动（它只认 SqliteDatabase 这个结构化接口）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeHttp from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRadio } from '../../core/radio.ts';
import { createRadioServer } from '../../core/server.ts';
import { SqliteStore } from '../../core/state/sqlite-store.ts';
import { mp3DurationMs } from '../../core/tts.ts';

const AT = new Date('2026-10-20T21:00:00.000Z');
const clock = { now: () => AT };
const TOKEN = 'tok-abc';
const KEY = 'sk-plain-do-not-leak';

const song = (id, name, artist) => ({
  id, name, ar: [{ name: artist }], al: { name: 'Album', picUrl: 'http://cover/' + id + '.jpg' }, dt: 187000,
});
const SONGS = [
  song(1001, 'Midnight Drive', 'The Long Way'),
  song(1002, 'Neon Hours', 'Kite & Ash'),
  song(1003, 'Slow Static', 'Marina Vale'),
];

// 造真能解析的 MPEG1 Layer III 帧（128kbps / 44100Hz），词时间戳才有真时长可算。
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];
const frame = (bitrateIndex, rateIndex) => {
  const length = Math.floor((144 * BITRATES[bitrateIndex] * 1000) / RATES[rateIndex]);
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xfb, (bitrateIndex << 4) | (rateIndex << 2), 0xc4], 0);
  return bytes;
};
const mp3 = (count) => Buffer.concat(Array.from({ length: count }, () => frame(9, 0)));
const AUDIO = mp3(10);
const AUDIO_MS = mp3DurationMs(AUDIO);

const json = (body) => ({ status: 200, text: async () => JSON.stringify(body), bytes: async () => new Uint8Array() });
const notFound = () => ({ status: 404, text: async () => '{"code":404}', bytes: async () => new Uint8Array() });

const SHOW = {
  say: ['One slow thing to start.', 'Then something even slower.'],
  play: ['1001', '1002', '1003'],
  reason: 'quiet set for a late hour',
  segue: null,
};

// 一次 think = 两次补全：先要工具、再定稿。这是真的 tool loop，不是模型自言自语。
const llmRoute = (firstArgs, showArgs) => {
  let calls = 0;
  const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  return () => {
    calls += 1;
    const message = calls % 2 === 1
      ? { content: null, tool_calls: [toolCall('c' + calls, 'recommend_tracks', firstArgs)] }
      : { content: null, tool_calls: [toolCall('c' + calls, 'emit_show', showArgs)] };
    return json({ choices: [{ message, finish_reason: 'tool_calls' }] });
  };
};

const routes = (map) => {
  const calls = [];
  const fetch = async (request) => {
    const path = new URL(request.url).pathname;
    calls.push({ url: request.url, path, headers: request.headers, body: request.body });
    const handler = map[path];
    if (handler === undefined) return notFound();
    // 路由表里两种都允许：现成的响应对象，或者一个按请求算响应的函数。
    return typeof handler === 'function' ? handler(request) : handler;
  };
  return { fetch, calls };
};

const NETEASE_UP = {
  '/cloudsearch': json({ result: { songs: SONGS } }),
  '/song/url/v1': json({ data: [{ url: 'http://cdn.example/1001.mp3', level: 'exhigh' }] }),
};

const setup = async (options = {}) => {
  const store = new SqliteStore(new DatabaseSync(':memory:'), clock);
  await store.setPref('llm.baseUrl', 'http://llm.test/v1');
  await store.setPref('llm.model', 'test-model');
  // 这些用例要的是「HTTP 上的那个 provider」：假 fetch 只桩了 /v1/tts，所以显式选 fish。
  // 默认的 piper 要真的 exe 与模型，属于 tools/smoke-tts.mjs 的活。
  await store.setPref('tts.provider', 'fish');
  await store.setPref('tts.baseUrl', 'http://tts.test');
  await store.setPref('tts.apiKey', 'fish-test');
  if (options.llmKey !== false) await store.setPref('llm.apiKey', options.llmKey ?? KEY);

  const learned = [];
  const localDir = mkdtempSync(join(tmpdir(), 'edgerunner-local-'));
  if (options.localFile !== undefined) writeFileSync(join(localDir, options.localFile), AUDIO);

  const { fetch, calls } = routes({
    ...(options.netease ?? NETEASE_UP),
    '/v1/chat/completions': llmRoute(
      options.firstArgs ?? { genres: ['ambient'], mood: 'low and steady', limit: 3 },
      options.showArgs ?? SHOW,
    ),
    '/v1/tts': () => ({ status: 200, text: async () => '', bytes: async () => AUDIO }),
  });

  const radio = createRadio({
    store,
    clock,
    taste: {
      read: async () => ({ genres: ['ambient'], corpus: [{ name: 'taste.md', text: 'slow, warm, nothing fast' }], recent: [] }),
      appendLearned: async (line) => { learned.push(line); },
    },
    env: { weather: async () => null, calendar: async () => [] },
    neteaseBaseUrl: 'http://music.test',
    localDir,
    cacheDir: mkdtempSync(join(tmpdir(), 'edgerunner-cache-')),
    // 装配点要一个 ttsDir。上面的 tts.provider=fish 决定了它不会被用到。
    ttsDir: mkdtempSync(join(tmpdir(), 'edgerunner-ttsdir-')),
    fetch,
  });
  return { radio, store, calls, learned };
};

const waitFor = async (predicate, ms = 3000) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor 超时');
};

const subscribe = (radio) => {
  const events = [];
  radio.subscribe((event) => events.push(event));
  return events;
};

test('boot 之后：队列与当前曲目就位，口播一句一句到，音频与词表同源', async () => {
  const { radio } = await setup();
  const events = subscribe(radio);
  assert.deepEqual(events.map((event) => event.type), ['now', 'queue', 'state'], '连上先给一份快照');

  await radio.boot();
  await waitFor(() => events.filter((event) => event.type === 'say').length >= 2);

  assert.deepEqual(radio.queue().map((ref) => ref.id), ['1001', '1002', '1003']);
  const now = radio.now();
  assert.equal(now.track.id, '1001');
  assert.equal(now.track.source, 'netease', 'onStep 的工具结果要进小目录（degraded 靠它推断）');
  assert.equal(now.degraded, false);
  assert.equal(now.djState, 'idle', '口播说完要落回 idle');

  const says = events.filter((event) => event.type === 'say');
  assert.deepEqual(says.map((event) => event.payload.index), [0, 1]);
  assert.deepEqual(says.map((event) => event.payload.line), SHOW.say);
  for (const event of says) {
    assert.match(event.payload.audioUrl, /^\/tts\/[0-9a-f]{40}\.mp3$/);
    assert.equal(event.payload.words.at(-1).endMs, AUDIO_MS, '末词必须收在音频真实总长上');
  }
  const key = says[0].payload.audioUrl.slice('/tts/'.length, -'.mp3'.length);
  assert.ok(radio.ttsAudio(key).byteLength > 0, '说过的话要能从缓存取回');
  assert.equal(radio.ttsAudio('f'.repeat(40)), null, '没缓存的 key 取不到');

  assert.deepEqual(events.at(-1), { type: 'now', payload: radio.now() }, '口播收尾会把 now 重发一次');
});

test('chat：立刻回一段 Show，且对话进历史', async () => {
  const { radio } = await setup();
  await radio.boot();
  const show = await radio.chat('something quiet please');

  assert.deepEqual(show.say, SHOW.say);
  assert.deepEqual(show.play.map((ref) => ref.id), ['1001', '1002', '1003']);
  assert.ok(show.reason.length > 0);

  const history = await radio.history(10);
  assert.ok(history.some((message) => message.role === 'me' && message.text === 'something quiet please'));
  assert.ok(history.some((message) => message.role === 'dj' && message.text === SHOW.say[0]));
});

test('降级：源不可达时链落到本地，degraded 由队列推断出来', async () => {
  const file = 'Ivo Sand - Room Tone.mp3';
  const { radio } = await setup({
    netease: {},
    localFile: file,
    firstArgs: { genres: ['ambient'], limit: 3 },
    showArgs: { say: ['Only what is on this machine.'], play: ['local:' + file], reason: 'offline', segue: null },
  });
  await radio.boot();

  const now = radio.now();
  assert.equal(now.track.source, 'local');
  assert.equal(now.track.title, 'Room Tone');
  assert.equal(radio.queue().length, 1);
  assert.equal(now.degraded, true, '队列里只剩本地源 = 降级');
});

const listen = async (radio) => {
  const server = createRadioServer({ radio, token: TOKEN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: 'http://127.0.0.1:' + server.address().port };
};

const call = async (base, path, request = {}) => {
  const headers = {};
  if (request.token !== false) headers['x-radio-token'] = TOKEN;
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, {
    method: request.method ?? 'GET',
    headers,
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, headers: response.headers, text, json: parsed };
};

test('HTTP：设置写入只回显「已配置」，明文 key 不出现在任何响应里', async () => {
  const { radio } = await setup({ llmKey: false });
  const { server, base } = await listen(radio);
  try {
    assert.equal((await call(base, '/api/now', { token: false })).status, 401, '缺令牌要挡住');

    const saved = await call(base, '/api/settings', { method: 'PUT', body: { llm: { apiKey: KEY } } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.llm.apiKeySet, true);
    assert.equal(saved.json.music.cookieSet, false);
    assert.ok(!saved.text.includes(KEY), '明文 key 永不出现在响应里');

    const read = await call(base, '/api/settings');
    assert.equal(read.json.llm.apiKeySet, true);
    assert.ok(!read.text.includes(KEY));
    assert.equal(read.json.llm.model, 'test-model', '只改一个 key，别的设置不动');
  } finally {
    server.close();
  }
});

test('HTTP：没有 LLM key 时 chat 回 503 NO_LLM_KEY，而不是把电台弄炸', async () => {
  const { radio } = await setup({ llmKey: false });
  await radio.boot();
  const { server, base } = await listen(radio);
  try {
    const response = await call(base, '/api/chat', { method: 'POST', body: { text: 'hello' } });
    assert.equal(response.status, 503);
    assert.deepEqual(response.json.error, {
      code: 'NO_LLM_KEY',
      message: 'No LLM key configured. Open Settings and add one.',
      retryable: false,
    });
  } finally {
    server.close();
  }
});

test('HTTP：媒体路径豁免令牌 —— /tts 给字节、/api/audio 302 到远端', async () => {
  const { radio } = await setup();
  const events = subscribe(radio);
  await radio.boot();
  await waitFor(() => events.filter((event) => event.type === 'say').length >= 2);
  const { server, base } = await listen(radio);
  try {
    const url = events.find((event) => event.type === 'say').payload.audioUrl;
    const audio = await call(base, url, { token: false });
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Number(audio.headers.get('content-length')), AUDIO.byteLength);

    const ranged = await fetch(base + url, { headers: { range: 'bytes=0-9' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 0-9/' + AUDIO.byteLength);

    assert.equal((await call(base, '/tts/' + 'f'.repeat(40) + '.mp3', { token: false })).status, 404);

    const redirect = await fetch(base + '/api/audio/1001?level=exhigh', { redirect: 'manual' });
    assert.equal(redirect.status, 302, '远端 CDN 认 Range，中间过一手会坏播放器');
    assert.equal(redirect.headers.get('location'), 'http://cdn.example/1001.mp3');
  } finally {
    server.close();
  }
});

test('HTTP：播放事实、喜欢、统计、历史、日表都从这一处出', async () => {
  const { radio, learned } = await setup();
  await radio.boot();
  const { server, base } = await listen(radio);
  try {
    const played = await call(base, '/api/playback', {
      method: 'POST',
      body: { songId: '1002', event: 'started', at: AT.toISOString() },
    });
    assert.equal(played.status, 200);
    assert.deepEqual(played.json, { ok: true });
    assert.equal((await call(base, '/api/now')).json.track.id, '1002', 'started 同时是「我切到这首了」');

    assert.equal((await call(base, '/api/feedback', { method: 'POST', body: { songId: '1002', action: 'like' } })).status, 200);
    assert.deepEqual((await call(base, '/api/favorites')).json.map((ref) => ref.id), ['1002']);
    assert.equal((await call(base, '/api/feedback', { method: 'POST', body: { songId: '1002', action: 'unlike' } })).status, 200);
    assert.deepEqual((await call(base, '/api/favorites')).json, []);
    assert.deepEqual(learned, ['Kept Neon Hours — Kite & Ash.', 'Dropped Neon Hours — Kite & Ash.'], '♡ 是人的动作，记成一条学到的（ADR-0004）');

    const stats = (await call(base, '/api/stats')).json;
    assert.equal(stats.played, 1);
    assert.deepEqual(stats.topArtists, [{ artist: 'Kite & Ash', count: 1 }]);
    assert.ok((await call(base, '/api/history')).json.some((message) => message.role === 'dj'));
    assert.ok((await call(base, '/api/taste')).json.corpus.length > 0);

    assert.notEqual((await call(base, '/api/plan/today')).json, null, '开机第一件事就是排今天的日表（ADR-0024）');
    const plan = await call(base, '/api/plan/regenerate', { method: 'POST', body: { reason: 'too loud' } });
    assert.equal(plan.status, 200);
    assert.equal(plan.json.blocks.length, 3);
    assert.deepEqual(plan.json.blocks.map((block) => block.mood), ['morning', 'daytime', 'late-night']);
    assert.equal(plan.json.blocks[0].tracks.length, 3);
    assert.notEqual((await call(base, '/api/plan/today')).json, null, '再生之后日表要落库');

    const missing = await call(base, '/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'INTERNAL', '错误码是封闭枚举，没有「参数不合法」这一档');
  } finally {
    server.close();
  }
});

test('WS：/stream 完成握手，Accept 按 RFC 算出来', async () => {
  const { radio } = await setup();
  await radio.boot();
  const { server, base } = await listen(radio);
  try {
    const handshake = await new Promise((resolve) => {
      const client = nodeHttp;
      const request = client.request(base + '/stream', {
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'sec-websocket-version': '13',
        },
      });
      request.on('upgrade', (response, socket) => {
        socket.destroy();
        resolve({ status: response.statusCode, accept: response.headers['sec-websocket-accept'] });
      });
      request.on('error', () => resolve({ status: 0, accept: null }));
      request.end();
    });
    assert.equal(handshake.status, 101);
    assert.equal(handshake.accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  } finally {
    server.close();
  }
});