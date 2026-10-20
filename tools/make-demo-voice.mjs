#!/usr/bin/env node
// 把首次体验那段口播**合成出来**（ADR-0033）。音频随包发，所以它必须可复现：
//   node --experimental-strip-types tools/make-demo-voice.mjs
//
// 它**故意**走 core 自己的那套（createPiperTts + createTtsEngine），而不是直接调 piper.exe：
// 这样产出的音频与运行时听到的是同一条路（同样的嗓子、同样的合成参数）；
// 哪天出厂嗓换了，重跑一遍就跟着换。文案的唯一真相在 core/demo.ts。
import { copyFileSync, mkdtempSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPiperTts } from '../core/providers/tts-piper.ts';
import { createTtsEngine, wavDurationMs } from '../core/tts.ts';
import { DEMO_LINE } from '../core/demo.ts';

const OUT = 'assets/demo/sign-of-the-times.wav';
const ttsDir = process.env.EDGERUNNER_TTS_DIR ?? join(process.env.APPDATA ?? '', 'edgerunner', 'tts');

if (!existsSync(join(ttsDir, 'piper.exe'))) {
  console.error('找不到 piper 运行时：' + ttsDir + '（先跑 npm run fetch:voice，或从打包产物里拿）');
  process.exit(1);
}

const cache = mkdtempSync(join(tmpdir(), 'edgerunner-demo-voice-'));
const engine = createTtsEngine({ provider: createPiperTts({ dir: ttsDir }), dir: cache });
const spoken = await engine.speak(0, DEMO_LINE, '');
copyFileSync(join(cache, engine.keyOf(DEMO_LINE, '') + '.wav'), OUT);

console.log('文案：' + DEMO_LINE);
console.log('缓存 key：' + engine.keyOf(DEMO_LINE, ''));
console.log('写出：' + OUT + '（' + statSync(OUT).size + ' 字节，' + (wavDurationMs(readFileSync(OUT)) / 1000).toFixed(1) + ' 秒）');
console.log('词时间戳：' + spoken.words.length + ' 个词');