// 4.6 的自检：语料在磁盘上的形状 —— 人写的 md 只读，系统的结论只进库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTasteRepo } from '../../core/taste.ts';
import { SqliteStore } from '../../core/state/sqlite-store.ts';

const CLOCK = { now: () => new Date('2026-10-20T21:00:00.000Z') };
const store = () => new SqliteStore(new DatabaseSync(':memory:'), CLOCK);

const dir = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'edgerunner-taste-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
};

test('语料 = 目录里的每一个 .md，按文件名排序；没有目录就是没有语料', async () => {
  const repo = createTasteRepo({
    dir: dir({ 'notes.md': 'If I ask for focus, drop the vocals.', 'likes.md': '  Warm synth, quiet vocals.  ' }),
    store: store(),
    clock: CLOCK,
  });
  const doc = await repo.read();
  assert.deepEqual(doc.corpus.map((entry) => entry.name), ['likes.md', 'notes.md'], '顺序要稳定，UI 才不跳');
  assert.equal(doc.corpus[0].text, 'Warm synth, quiet vocals.', '原文两端不留空白');
  assert.deepEqual(doc.genres, [], '没有 genres.txt 就不给胶囊，不编一组出来');
  assert.deepEqual(doc.recent, []);

  const missing = createTasteRepo({ dir: join(tmpdir(), 'edgerunner-does-not-exist'), store: store(), clock: CLOCK });
  assert.deepEqual((await missing.read()).corpus, [], '目录不存在 = 还没有语料，不是错误');
});

test('曲风胶囊是数据：写在 genres.txt 里，去重、去空', async () => {
  const repo = createTasteRepo({
    dir: dir({ 'genres.txt': 'JAZZ-HIPHOP, POST-PUNK ,JAZZ-HIPHOP,, RAIN NOISE\n', 'likes.md': 'x' }),
    store: store(),
    clock: CLOCK,
  });
  assert.deepEqual((await repo.read()).genres, ['JAZZ-HIPHOP', 'POST-PUNK', 'RAIN NOISE']);
});

test('appendLearned 只写库：语料是人的地盘，系统永不回写', async () => {
  const repo = createTasteRepo({ dir: dir({ 'likes.md': 'Warm synth.' }), store: store(), clock: CLOCK });
  await repo.appendLearned('Kept Neon Hours — Kite & Ash.', { ts: '', text: '', evidence: { action: 'like' } });

  const doc = await repo.read();
  assert.equal(doc.recent.length, 1);
  assert.equal(doc.recent[0].text, 'Kept Neon Hours — Kite & Ash.');
  assert.equal(doc.recent[0].ts, '2026-10-20T21:00:00.000Z', '时间戳由仓库自己盖（注入的 Clock）');
  assert.deepEqual(doc.recent[0].evidence, { action: 'like' });
  assert.equal(doc.corpus[0].text, 'Warm synth.', 'md 一个字节没变');
});