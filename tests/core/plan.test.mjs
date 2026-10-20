// 排日表那一格的取舍：排表的人给了就用，没给 / 挂了就自己搜 —— 两个来源怎么合（ADR-0030）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDayPlan } from '../../core/plan.ts';

const DAY = { date: '2026-10-21', createdAt: '2026-10-21T00:00:00.000Z' };
const ref = (id) => ({ id, title: 'T' + id, artist: 'A' });

/** 假的音乐源：记下每一次「要歌」用的场景词，按 limit 回一批 id 里带氛围名的歌。 */
const source = () => {
  const asked = [];
  return {
    asked,
    music: {
      id: 'fake',
      recommend: async (seed, limit) => {
        asked.push(seed);
        return Array.from({ length: limit }, (_, index) => ({ id: seed.mood + index, title: 'T', artist: 'A', source: 'fake' }));
      },
      search: async () => [],
      resolve: async () => null,
    },
  };
};

test('排表的人给了就用：按槽位对齐，搜索一次都没发生', async () => {
  const { asked, music } = source();
  const plan = await buildDayPlan({ ...DAY, music, curate: async () => [[ref('a')], [ref('b')], [ref('c')]] });

  assert.deepEqual(plan.blocks.map((block) => block.tracks.map((track) => track.id)), [['a'], ['b'], ['c']]);
  assert.deepEqual(plan.blocks.map((block) => block.mood), ['morning', 'daytime', 'late-night'], '槽位仍是产品写死的那三格');
  assert.equal(plan.active, true);
  assert.deepEqual(asked, [], '有人排过的地方不必再搜');
});

test('排表的人只给了一格：另外两格各自退到搜索', async () => {
  const { asked, music } = source();
  const plan = await buildDayPlan({ ...DAY, music, curate: async () => [[ref('a')]] });

  assert.deepEqual(plan.blocks[0].tracks.map((track) => track.id), ['a']);
  assert.deepEqual(plan.blocks.map((block) => block.tracks.length), [1, 3, 3]);
  assert.deepEqual(asked.map((seed) => seed.mood), ['daytime', 'late-night'], '缺的那两格才去搜，而且搜的是它们自己的氛围');
});

test('排表的人抛错：整份退到逐格搜索，不抛错 —— 排不出日表不该把电台拦下来', async () => {
  const { asked, music } = source();
  const plan = await buildDayPlan({ ...DAY, music, curate: async () => { throw new Error('LLM 挂了'); } });

  assert.deepEqual(plan.blocks.map((block) => block.tracks.length), [3, 3, 3]);
  assert.deepEqual(asked.map((seed) => seed.mood), ['morning', 'daytime', 'late-night']);
});

test('排表的人回 null（没配 key）＝ 同一件事：三格全搜', async () => {
  const { asked, music } = source();
  const plan = await buildDayPlan({ ...DAY, music, curate: async () => null });
  assert.deepEqual(plan.blocks.map((block) => block.tracks.length), [3, 3, 3]);
  assert.equal(asked.length, 3);
});

test('没有排表的人：就是原来那个 buildDayPlan，三格按各自的曲风去搜', async () => {
  const { asked, music } = source();
  const plan = await buildDayPlan({ ...DAY, music });

  assert.deepEqual(plan.blocks.map((block) => block.tracks.length), [3, 3, 3]);
  assert.deepEqual(asked[0], { genres: ['acoustic', 'jazz'], mood: 'morning' });
  assert.deepEqual(asked[1], { genres: ['indie-pop', 'electronic'], mood: 'daytime' });
  assert.deepEqual(asked[2], { genres: ['ambient', 'synthwave'], mood: 'late-night' });
});

test('源不可达：那一格留空，不把整份日表搞坏', async () => {
  const music = {
    id: 'broken',
    recommend: async () => { throw new Error('MUSIC_SOURCE_UNREACHABLE'); },
    search: async () => [],
    resolve: async () => null,
  };
  const plan = await buildDayPlan({ ...DAY, music });
  assert.deepEqual(plan.blocks.map((block) => block.tracks), [[], [], []]);
  assert.deepEqual(plan.blocks.map((block) => block.mood), ['morning', 'daytime', 'late-night'], '格还在，只是空的');
});