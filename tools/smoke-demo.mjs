#!/usr/bin/env node
// 首次体验冒烟：不给 key、不给 cookie，起一台**真**电台 ——
// 看它是不是随包的那一首 + 出厂冻下来的那段口播，以及那份音频是不是原样发得出来。
// CI 里不跑（要 assets/demo 的真素材）；这是给人手工验收用的。
//
//   node --experimental-strip-types tools/smoke-demo.mjs
//
// 全程不联网：音乐源那条路留给一个没人应答的端口，它该自己退到本地曲库。
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRadio } from '../main/bootstrap.ts';
import { DEMO_LINE, DEMO_SONG_FILE, DEMO_WAV_FILE } from '../core/demo.ts';

const demoDir = join(process.cwd(), 'assets', 'demo');
const shippedWav = join(demoDir, DEMO_WAV_FILE);
if (!existsSync(shippedWav) || !existsSync(join(demoDir, DEMO_SONG_FILE))) {
  console.error('✗ 素材不全：' + demoDir + ' —— 口播由 node --experimental-strip-types tools/make-demo-voice.mjs 合成');
  process.exit(1);
}

const tmp = (name) => mkdtempSync(join(tmpdir(), 'edgerunner-demo-' + name + '-'));
const started = await startRadio({
  dataDir: tmp('data'),
  localDir: tmp('music'),
  uiDir: tmp('ui'),
  ttsDir: tmp('piper'),
  demoDir,
  warn: (message) => console.log('  · ' + message),
});

const events = [];
started.radio.subscribe((event) => events.push(event));
const began = Date.now();
await started.boot();
const elapsed = Math.round((Date.now() - began) / 1000);

const failed = [];
const check = (ok, label, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + label + (detail === undefined ? '' : ' —— ' + detail));
  if (!ok) failed.push(label);
};

const queue = started.radio.queue();
const now = started.radio.now();
const say = events.find((event) => event.type === 'say');
const codes = events.filter((event) => event.type === 'error').map((event) => event.payload.code);

check(queue.length === 1 && queue[0].id.endsWith(DEMO_SONG_FILE), '队列里就是随包那一首', queue.map((ref) => ref.id).join(', '));
check(now.track.artist === 'Harry Styles' && now.track.title === 'Sign of the Times', '本地源从文件名认出了歌手 / 标题', now.track.artist + ' — ' + now.track.title);
check(say !== undefined && say.payload.kind === 'intro' && say.payload.line === DEMO_LINE, '口播是一条 intro，文案与 core/demo.ts 一字不差', say === undefined ? '没有 say 事件' : say.payload.line);
check(say !== undefined && say.payload.words.length > 3, '词时间戳来自那份真音频', say === undefined ? '没有 say 事件' : say.payload.words.length + ' 个词');

const shipped = readFileSync(shippedWav);
// 路径是 /tts/<key>.<ext>：server 自己要的那一段 key **不带后缀**（core/server.ts 的 TTS_PATH）。
const name = say === undefined ? '' : say.payload.audioUrl.slice(say.payload.audioUrl.lastIndexOf('/') + 1);
const key = name.slice(0, Math.max(0, name.lastIndexOf('.')));
const served = key === '' ? null : started.radio.ttsAudio(key);
check(served !== null && Buffer.from(served).equals(shipped), '发出去的字节 = 随包的那份 wav', served === null ? '取不到音频' : Buffer.from(served).byteLength + ' 字节');
check(codes.includes('NO_LLM_KEY'), '引导横幅是 NO_LLM_KEY', codes.join(', ') || '一条都没有');

console.log('\n开机用了 ' + elapsed + 's · 事件 ' + events.length + ' 条');
await started.close();
if (failed.length > 0) {
  console.error('✗ 冒烟失败：' + failed.join(' / '));
  process.exit(1);
}
console.log('✓ 冒烟通过 —— 没 key 的一台电台，出厂就有歌、有口播。');