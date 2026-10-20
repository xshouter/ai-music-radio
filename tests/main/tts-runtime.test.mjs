// resolveTtsDir 的自检：非 ASCII 源 → 落到 ASCII 落点；落点里已有旧的一份时，只补缺的音色，不重装。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTtsDir } from '../../main/tts-runtime.ts';

const scratch = () => mkdtempSync(join(tmpdir(), 'edgerunner-tts-runtime-'));

test('源是 ASCII 就直接用源，一份都不拷', () => {
  const base = scratch();
  const ascii = join(base, 'piper');
  mkdirSync(ascii, { recursive: true });
  assert.equal(resolveTtsDir(ascii, join(base, 'dest'), join(base, 'other')), ascii);
  assert.equal(existsSync(join(base, 'dest')), false, '源能用就不该产生落点');
});

test('落点已有运行时但缺新音色：补模型，不整套重装、也不删旧的', () => {
  const base = scratch();
  const source = join(base, '音乐电台', 'piper'); // 非 ASCII：正是仓库自己的路径形状
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'piper.exe'), 'exe');
  writeFileSync(join(source, 'en_US-ryan-high.onnx'), 'new-voice');
  writeFileSync(join(source, 'en_US-ryan-high.onnx.json'), 'new-config');

  const dest = join(base, 'dest');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'piper.exe'), 'exe'); // 上一次装的那一份
  writeFileSync(join(dest, 'en_US-amy-medium.onnx'), 'old-voice');

  assert.equal(resolveTtsDir(source, dest, join(base, 'secondary')), dest, '源非 ASCII 就用落点');
  assert.equal(readFileSync(join(dest, 'en_US-ryan-high.onnx'), 'utf8'), 'new-voice', '新音色必须补进落点');
  assert.equal(readFileSync(join(dest, 'en_US-ryan-high.onnx.json'), 'utf8'), 'new-config', '配置也要跟上');
  assert.equal(existsSync(join(dest, 'en_US-amy-medium.onnx')), true, '旧的一份不删 —— 用户可能切回去');
});

test('落点里什么都没有：整套拷过去', () => {
  const base = scratch();
  const source = join(base, '音乐电台', 'piper');
  mkdirSync(join(source, 'espeak-ng-data'), { recursive: true });
  writeFileSync(join(source, 'piper.exe'), 'exe');
  writeFileSync(join(source, 'espeak-ng-data', 'phontab'), 'data');

  const dest = join(base, 'fresh');
  assert.equal(resolveTtsDir(source, dest, join(base, 'secondary')), dest);
  assert.equal(readFileSync(join(dest, 'piper.exe'), 'utf8'), 'exe');
  assert.equal(readFileSync(join(dest, 'espeak-ng-data', 'phontab'), 'utf8'), 'data');
});