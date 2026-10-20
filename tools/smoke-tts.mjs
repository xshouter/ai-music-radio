#!/usr/bin/env node
// 真 key 冒烟：把嗓子接上一次**真**合成，证明 Fish Audio 的接口形状没记错。
// CI 里不跑（没有 key，也不该烧钱）；这是给人手工验收用的。
//
// 用法：
//   node --experimental-strip-types tools/smoke-tts.mjs --key-file <path>
//   FISH_API_KEY=... node --experimental-strip-types tools/smoke-tts.mjs
//   node --experimental-strip-types tools/smoke-tts.mjs --provider=piper --runtime=<vendor/piper>  （本地嗓子，不需要 key）
// 可选：--voice=<reference_id> --model=s2-pro --dir=<缓存目录> --text=<要说的话>
//
// 规矩：这个脚本**永远不打印 key**，任何输出都先过一遍 mask()。
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTtsDir } from '../main/tts-runtime.ts';
import { createTtsEngine } from '../core/tts.ts';
import { createFishTts } from '../core/providers/tts-fish.ts';
import { createPiperTts } from '../core/providers/tts-piper.ts';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const readKey = () => {
  if (process.env.FISH_API_KEY) return process.env.FISH_API_KEY.trim();
  const file = arg('key-file', '');
  if (file === '') return '';
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};

const provider = arg('provider', 'fish');
const key = readKey();
const mask = (text) => String(text).split(key).join(key === '' ? '' : '***');
if (provider !== 'piper' && key === '') {
  console.error('✗ 没有拿到 key。用 --key-file=<path> 或 FISH_API_KEY=... 给一个。');
  process.exit(1);
}

// 目录里**放一句真的**：与界面上的口播同形（英文、一句话）。
const text = arg('text', 'Midnight Drive, by The Long Way. Slow synth, and nothing above a walking pace.');
const voice = arg('voice', provider === 'piper' ? 'en_GB-alan-medium' : '');
const dir = arg('dir', join(process.cwd(), 'cache', 'tts'));

const engine = createTtsEngine({
  provider:
    provider === 'piper'
      ? createPiperTts({
          dir: resolveTtsDir(
            arg('runtime', join(process.cwd(), 'vendor', 'piper')),
            join(tmpdir(), 'edgerunner-piper'),
            join(process.env.ProgramData ?? 'C:\\ProgramData', 'EdgeRunner', 'piper'),
          ),
        })
      : createFishTts({
          apiKey: key,
          ...(arg('model', '') === '' ? {} : { model: arg('model', '') }),
          ...(arg('base-url', '') === '' ? {} : { baseUrl: arg('base-url', '') }),
        }),
  dir,
});

console.log('→ ' + provider + ' · key ' + key.slice(0, 3) + '…(' + key.length + ') · 缓存 ' + dir);
try {
  const line = await engine.speak(0, text, voice);
  const audio = engine.read(engine.keyOf(text, voice));
  console.log('✓ audioUrl: ' + line.audioUrl);
  console.log('✓ 字节: ' + (audio === null ? 0 : audio.byteLength) + ' · 词数: ' + line.words.length);
  console.log('✓ 总长: ' + line.words[line.words.length - 1].endMs + 'ms');
  console.log('✓ 词表: ' + line.words.map((w) => w.text + '(' + w.startMs + '-' + w.endMs + ')').join(' '));
  console.log('✓ 冒烟通过 —— 用播放器打开 ' + join(dir, line.audioUrl.slice(line.audioUrl.lastIndexOf('/') + 1)) + ' 听一遍。');
} catch (error) {
  console.error('✗ 冒烟失败：' + mask(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}