// 4.1 的自检：SqliteStore 与 MemoryStore 必须**行为一致**。
// 单测一个实现只能证明那个实现自洽；两个实现对着同一串操作跑，才能证明「语义只写了一遍」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../../core/state/sqlite-store.ts';
import { MemoryStore } from '../../core/state/memory-store.ts';

const T = (n) => `2026-10-20T10:${String(n).padStart(2, '0')}:00.000Z`;

const fakeClock = (iso) => ({ now: () => new Date(iso) });

const TRACKS = {
  a: { id: 'n1001', title: 'Midnight Drive', artist: 'The Long Way', source: 'netease' },
  b: { id: 'n1003', title: 'Slow Static', artist: 'Marina Vale', source: 'netease' },
  c: { id: 'n1006', title: 'Half a Morning', artist: 'Ivo Sand', source: 'netease' },
};

const play = (track, ts, patch = {}) => ({
  ts, songId: track.id, title: track.title, artist: track.artist, source: track.source,
  level: 'exhigh', startedAt: ts, endedAt: null, skipped: false, reason: null, ...patch,
});

const ref = (t) => ({ id: t.id, title: t.title, artist: t.artist });

// 同一串操作打两个实现，收成一份快照再比 —— 快照里只放接口能看见的东西。
async function scenario(store) {
  // 消息：两条同一时间戳，用来钉死「时间戳相同时越晚插入越靠前」。
  await store.appendMessage({ id: 'm1', ts: T(1), role: 'system', text: 'Station up.' });
  await store.appendMessage({ id: 'm2', ts: T(2), role: 'dj', text: 'Evening.' });
  await store.appendMessage({ id: 'm3', ts: T(2), role: 'me', text: 'something quiet', meta: { via: 'composer' } });

  // 播放：n1001 播两次（第二次是重播），n1003 被跳过。
  await store.recordPlay(play(TRACKS.a, T(3)));
  await store.recordPlay(play(TRACKS.b, T(4)));
  await store.recordPlay(play(TRACKS.a, T(5)));
  await store.recordPlay(play(TRACKS.a, T(6), { endedAt: T(6) }));
  await store.recordPlay(play(TRACKS.b, T(7), { endedAt: T(7), skipped: true }));
  // 收尾一条从没 started 过的：重复上报不该凭空造一条。
  await store.recordPlay(play(TRACKS.c, T(8), { endedAt: T(8) }));

  // 喜欢：like 幂等、unlike 删掉。
  await store.setFavorite(ref(TRACKS.b), true);
  await store.setFavorite(ref(TRACKS.c), true);
  await store.setFavorite(ref(TRACKS.b), true);
  await store.setFavorite(ref(TRACKS.c), false);

  // 设置项：默认值 + 写入 + 覆盖。
  const protocolDefault = await store.getPref('llm.protocol');
  const unset = await store.getPref('tts.apiKey');
  await store.setPref('llm.protocol', 'anthropic');
  await store.setPref('tts.voice', 'reference-1');
  await store.setPref('music.cookie', 'SESSDATA=secret');

  // 日表：同一 date 覆盖写。
  const plan = (active) => ({
    date: '2026-10-20', createdAt: T(1), active,
    blocks: [{ start: '22:00', end: '23:00', mood: 'low', genres: ['ambient'], tracks: [ref(TRACKS.c)] }],
  });
  await store.savePlan(plan(true));
  await store.savePlan(plan(false));

  await store.appendTasteUpdate({ ts: T(2), text: 'Prefers ambient after 23:00.', evidence: { skipped: ['n1004'] } });
  await store.appendTasteUpdate({ ts: T(9), text: 'Replays The Long Way.', evidence: { replays: 2 } });

  return {
    messages2: await store.recentMessages(2),
    messagesAll: await store.recentMessages(50),
    messagesClampLow: await store.recentMessages(-5),
    messagesNaN: await store.recentMessages(Number.NaN),
    stats: await store.playStats(new Date(T(0))),
    statsEmpty: await store.playStats(new Date('2026-10-21T00:00:00.000Z')),
    plays: await store.recentPlays(3),
    favorites: await store.favorites(),
    protocolDefault, unset,
    protocol: await store.getPref('llm.protocol'),
    voice: await store.getPref('tts.voice'),
    cookie: await store.getPref('music.cookie'),
    plan: await store.activePlan('2026-10-20'),
    missingPlan: await store.activePlan('2026-10-19'),
    taste: await store.recentTasteUpdates(5),
  };
}

const openSqlite = () => new SqliteStore(new DatabaseSync(':memory:'), fakeClock(T(0)));

test('SqliteStore 与 MemoryStore 对同一串操作给出同一份快照', async () => {
  const fromSqlite = await scenario(openSqlite());
  const fromMemory = await scenario(new MemoryStore(fakeClock(T(0))));
  assert.deepEqual(fromSqlite, fromMemory);
});

test('快照本身是对的：重播 / 跳过 / 喜欢的顺序与幂等', async () => {
  const snapshot = await scenario(new MemoryStore(fakeClock(T(0))));
  assert.deepEqual(snapshot.messages2.map((m) => m.id), ['m3', 'm2']);
  assert.deepEqual(snapshot.messagesClampLow.map((m) => m.id), ['m3']);
  assert.equal(snapshot.messagesNaN.length, 3);
  assert.deepEqual(snapshot.stats, {
    played: 3, skipped: 1, replays: 1,
    topArtists: [{ artist: 'The Long Way', count: 2 }, { artist: 'Marina Vale', count: 1 }],
  });
  assert.deepEqual(snapshot.statsEmpty, { played: 0, skipped: 0, replays: 0, topArtists: [] });
  // 收尾那条从没 started 过的记录没有留下痕迹：3 条 started 就是 3 条。
  assert.deepEqual(snapshot.plays.map((p) => p.songId), ['n1001', 'n1003', 'n1001']);
  assert.deepEqual(snapshot.favorites, [ref(TRACKS.b)]);
  assert.deepEqual(snapshot.protocolDefault, 'openai');
  assert.equal(snapshot.unset, '');
  assert.equal(snapshot.protocol, 'anthropic');
  assert.equal(snapshot.plan.active, false);
  assert.equal(snapshot.missingPlan, null);
  assert.deepEqual(snapshot.taste.map((u) => u.text), ['Replays The Long Way.', 'Prefers ambient after 23:00.']);
});

test('设置项坏在库里也不许把电台拦下来：回默认值 + 记一条警告', async () => {
  const db = new DatabaseSync(':memory:');
  const warnings = [];
  const store = new SqliteStore(db, fakeClock(T(0)), (message) => warnings.push(message));
  db.prepare('INSERT INTO prefs (key, value) VALUES (?, ?)').run('llm.protocol', 'gemini');
  assert.equal(await store.getPref('llm.protocol'), 'openai');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /gemini/);
});

test('迁移是幂等的：同一个库上再开一次 store 不报错也不丢数据', async () => {
  const db = new DatabaseSync(':memory:');
  const first = new SqliteStore(db, fakeClock(T(0)));
  await first.appendMessage({ id: 'm1', ts: T(1), role: 'dj', text: 'Evening.' });
  const second = new SqliteStore(db, fakeClock(T(0)));
  assert.deepEqual((await second.recentMessages(5)).map((m) => m.id), ['m1']);
});