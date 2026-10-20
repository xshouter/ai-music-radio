// 4.4 的自检：mp3 时长解析、词时间戳、内容寻址缓存、失败重试与 TTS_FAILED 语义。
// 全程零联网：喂一个按调用次数行为的假 provider。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTtsEngine, mp3DurationMs, wavDurationMs, wordsFor, TtsFailure } from '../../core/tts.ts';

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

// 造一个真的能解析的 MPEG1 Layer III 帧：同步字 + 版本/层 + 比特率 + 采样率。
const frame = (bitrateIndex, rateIndex) => {
  const length = Math.floor((144 * BITRATES[bitrateIndex] * 1000) / RATES[rateIndex]);
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xfb, (bitrateIndex << 4) | (rateIndex << 2), 0xc4], 0);
  return bytes;
};

const mp3 = (count, bitrateIndex = 9, rateIndex = 0) =>
  Buffer.concat(Array.from({ length: count }, () => frame(bitrateIndex, rateIndex)));

// 128kbps / 44100Hz：每帧 1152/44100*1000 = 26.122ms；10 帧取整 = 261ms。
const FRAME_MS = (1152 / 44100) * 1000;

const fakeProvider = (audio, failTimes = 0, format = 'mp3') => {
  const requests = [];
  return {
    id: 'fake',
    format,
    requests,
    async synthesize(req) {
      requests.push(req);
      if (requests.length <= failTimes) throw new Error('boom ' + requests.length);
      return { audio, contentType: 'audio/mpeg' };
    },
  };
};

const engineFor = (provider, overrides = {}) =>
  createTtsEngine({ provider, dir: mkdtempSync(join(tmpdir(), 'edgerunner-tts-')), retryDelayMs: 0, ...overrides });

test('mp3DurationMs：按帧头算总长，且能跳过 ID3v2 前缀', () => {
  const ten = mp3(10);
  assert.equal(mp3DurationMs(ten), Math.round(FRAME_MS * 10));
  assert.equal(mp3DurationMs(new Uint8Array(0)), 0);
  assert.equal(mp3DurationMs(new Uint8Array(64)), 0); // 全是 0：没有同步字

  const id3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20]), Buffer.alloc(20, 0), ten]);
  assert.equal(mp3DurationMs(id3), Math.round(FRAME_MS * 10));
});

test('wordsFor：总长与音频同源，末词收在真实总长上', () => {
  const words = wordsFor('Warm pads and a drum machine that never rushes', 4000);
  assert.equal(words[0].startMs, 0);
  assert.equal(words[words.length - 1].endMs, 4000);
  for (let i = 1; i < words.length; i += 1) {
    assert.equal(words[i].startMs, words[i - 1].endMs, '词与词之间不许有缝');
    assert.ok(words[i].endMs > words[i].startMs, '每个词都要占时间');
  }
  // 时长未知时退化成「一个覆盖全句的词」（ADR-0012 的兜底形状）。
  const degenerate = wordsFor('Short line', 0);
  assert.equal(degenerate.length, 1);
  assert.equal(degenerate[0].startMs, 0);
});

test('speak：命中缓存不再打远端，audioUrl 与 read 一致', async () => {
  const provider = fakeProvider(mp3(10));
  const engine = engineFor(provider);
  const first = await engine.speak(0, 'Midnight Drive by The Long Way.', 'voice-1');
  const second = await engine.speak(0, 'Midnight Drive by The Long Way.', 'voice-1');

  assert.equal(provider.requests.length, 1, '第二句必须命中缓存');
  assert.deepEqual(second, first);
  assert.equal(first.audioUrl, '/tts/' + engine.keyOf('Midnight Drive by The Long Way.', 'voice-1') + '.mp3');

  const key = engine.keyOf('Midnight Drive by The Long Way.', 'voice-1');
  assert.equal(engine.read(key).byteLength, mp3(10).byteLength);
  assert.equal(engine.read('not-a-hash'), null);
  assert.equal(engine.read('a'.repeat(40)), null, '没缓存过的 key 给 null');
  assert.equal(first.words[first.words.length - 1].endMs, Math.round(FRAME_MS * 10));
});

test('speak：键含音色与 providerId —— 换嗓子不串缓存', async () => {
  const provider = fakeProvider(mp3(4));
  const engine = engineFor(provider);
  const a = await engine.speak(0, 'Same words.', 'voice-a');
  const b = await engine.speak(0, 'Same words.', 'voice-b');
  assert.notEqual(a.audioUrl, b.audioUrl);
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(provider.requests.map((request) => request.voice), ['voice-a', 'voice-b']);
  assert.equal(provider.requests[0].format, 'mp3');
});

test('speak：失败重试一次，仍失败给 TTS_FAILED', async () => {
  const onceFailing = fakeProvider(mp3(3), 1);
  const engine = engineFor(onceFailing);
  const line = await engine.speak(0, 'Retry me.');
  assert.equal(onceFailing.requests.length, 2, '第一次失败后必须重试');
  assert.equal(line.line, 'Retry me.');

  const alwaysFailing = fakeProvider(mp3(3), 99);
  const failing = engineFor(alwaysFailing);
  await assert.rejects(() => failing.speak(0, 'Fail me.'), (error) => {
    assert.ok(error instanceof TtsFailure);
    assert.equal(error.code, 'TTS_FAILED');
    return true;
  });
  assert.equal(alwaysFailing.requests.length, 2, '重试一次即止，不无限打远端');
});

// 造一个真的能解析的 RIFF/WAVE：44.1kHz 单声道 16bit -> byteRate = 88200。
const wav = (seconds) => {
  const dataSize = Math.round(88200 * seconds);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (at, s) => {
    for (let i = 0; i < s.length; i += 1) bytes[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  return bytes;
};

test('wavDurationMs：data 字节数 / byteRate，认不出来给 0', () => {
  assert.equal(wavDurationMs(wav(2)), 2000);
  assert.equal(wavDurationMs(new Uint8Array(0)), 0);
  assert.equal(wavDurationMs(new Uint8Array(64)), 0);
  // 后面挂了一段垃圾：时长仍按 data 块算，不因为尾巴就崩。
  assert.equal(wavDurationMs(Buffer.concat([Buffer.from(wav(1)), Buffer.alloc(32, 7)])), 1000);
});

test('speak：provider 说 wav，缓存与路由就都是 .wav，时长走 wav 解析器', async () => {
  const provider = fakeProvider(wav(2), 0, 'wav');
  const engine = engineFor(provider);
  const line = await engine.speak(0, 'Offline voice.', 'en_US-amy-medium');
  assert.equal(provider.requests[0].format, 'wav');
  assert.ok(line.audioUrl.endsWith('.wav'), line.audioUrl);
  assert.equal(engine.read(engine.keyOf('Offline voice.', 'en_US-amy-medium')).byteLength, wav(2).byteLength);
  assert.equal(line.words[line.words.length - 1].endMs, 2000);
});

test('speak：缓存有上限 —— 超过就回收最旧的，绝不删刚写的那份', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edgerunner-tts-'));
  const provider = fakeProvider(mp3(2));
  const engine = createTtsEngine({ provider, dir, retryDelayMs: 0, maxFiles: 2 });
  for (const line of ['One.', 'Two.', 'Three.']) await engine.speak(0, line);

  const files = readdirSync(dir).filter((name) => name.endsWith('.mp3'));
  assert.equal(files.length, 2, '超过上限就得回收，缓存不许只增不减');
  assert.notEqual(engine.read(engine.keyOf('Three.')), null, '刚写的那份不许被回收');
  await engine.speak(0, 'Three.');
  assert.equal(provider.requests.length, 3, '留下的那份仍然命中缓存，不重新合成');
});

test('speak：远端给空音频也算失败', async () => {
  const empty = fakeProvider(new Uint8Array(0), 99);
  const engine = engineFor(empty);
  await assert.rejects(() => engine.speak(0, 'Silence.'), (error) => error.code === 'TTS_FAILED');
});