// 4.6 的自检：歌单 → 口味画像 → taste.md。零联网：一个脚本化的 llm + 一个假的音乐源。
// 这里要钉死三件事：模型写什么就落什么、人的语料不被碰、冷启动（没歌单）不写也不炸。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTasteFromLibrary } from '../../core/taste.ts';

const shelf = (tracks) => ({
  id: 'fake', recommend: async () => [], search: async () => [], resolve: async () => null,
  library: async () => tracks,
});

const scripted = (text, calls = []) => ({
  id: 'scripted',
  async complete(request) { calls.push(request); return { text, toolCalls: [], finishReason: 'stop' }; },
});

const track = (id, title, artist) => ({ id, title, artist, source: 'netease' });
const freshDir = () => mkdtempSync(join(tmpdir(), 'er-taste-'));

test('歌单 → taste.md：模型写什么就落什么，目录里别的 md 一个字节都不动', async () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'mine.md'), 'Nothing fast after 23:00.\r\n');
  const calls = [];
  const verdict = await buildTasteFromLibrary({
    music: shelf([track('1', 'Midnight Drive', 'The Long Way'), track('2', 'Slow Static', 'Marina Vale')]),
    llm: scripted('Warm synth, late nights, nothing above 100 bpm.', calls),
    model: 'test-model', dir,
  });

  assert.deepEqual(verdict, { written: true, reason: '', tracks: 2 });
  assert.equal(readFileSync(join(dir, 'taste.md'), 'utf8'), 'Warm synth, late nights, nothing above 100 bpm.\n');
  assert.equal(readFileSync(join(dir, 'mine.md'), 'utf8'), 'Nothing fast after 23:00.\r\n', '人写的语料一个字节都不许动');
  assert.equal(calls[0].model, 'test-model');
  assert.match(calls[0].messages[1].content, /The Long Way — Midnight Drive/, '歌单要原样进 prompt');
});

test('已经有一份 taste.md 就不覆盖 —— 那可能是人自己改过的', async () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'taste.md'), '手写的。\n');
  const calls = [];
  const verdict = await buildTasteFromLibrary({
    music: shelf([track('1', 'A', 'B')]), llm: scripted('whatever', calls), model: 'm', dir,
  });

  assert.deepEqual(verdict, { written: false, reason: 'taste.md already exists', tracks: 0 });
  assert.equal(readFileSync(join(dir, 'taste.md'), 'utf8'), '手写的。\n');
  assert.equal(calls.length, 0, '不覆盖时连模型都不叫');
});

test('曲库是空的：什么都不写，只回一个理由，不抛错', async () => {
  const dir = freshDir();
  const calls = [];
  const verdict = await buildTasteFromLibrary({ music: shelf([]), llm: scripted('x', calls), model: 'm', dir });

  assert.deepEqual(verdict, { written: false, reason: 'no library to read', tracks: 0 });
  assert.equal(existsSync(join(dir, 'taste.md')), false);
  assert.equal(calls.length, 0);
});
