// 排表提示词的自检：三格是「氛围提示」不是过滤器，第一段一个字都不提搜索（ADR-0031）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPrompt, systemPrompt } from '../../core/prompt.ts';
import { TOOLS } from '../../core/brain/index.ts';

const NOW = new Date('2026-10-20T22:10:00.000Z');
const CTX = {
  now: NOW, trigger: 'schedule', userText: undefined,
  taste: { genres: [], corpus: [], recent: [] },
  recentPlays: [], weather: null, plan: null,
};
const SPECS = [
  { start: '07:00', end: '12:00', mood: 'morning', genres: ['acoustic', 'jazz'] },
  { start: '12:00', end: '18:00', mood: 'daytime', genres: ['indie-pop', 'electronic'] },
  { start: '18:00', end: '02:00', mood: 'late-night', genres: ['ambient', 'synthwave'] },
];

test('第一段：三格是 flavour 不是过滤器，且一个字都不提 search_tracks', () => {
  const { user } = planPrompt(CTX, SPECS);
  assert.match(user, /1\. 07:00-12:00 morning: warm, unhurried, acoustic-leaning/);
  assert.match(user, /2\. 12:00-18:00 daytime: bright, mid-tempo, indie-leaning/);
  assert.match(user, /3\. 18:00-02:00 late-night: sparse, low, after-hours/);
  assert.match(user, /3 tracks per block/);
  assert.match(user, /flavour, not a filter/);
  assert.match(user, /daily_recommend/);
  assert.ok(!user.includes('acoustic, jazz'), '曲风不再当过滤器印在槽位上');
  assert.ok(!user.includes('search_tracks'), '第一段不给搜索');
});

test('第二段：只带不满的那一格，到这里才提 search_tracks', () => {
  const { user } = planPrompt(CTX, [SPECS[1]], true);
  assert.match(user, /1\. 12:00-18:00 daytime/);
  assert.ok(!user.includes('07:00-12:00'), '第二段只带那一格');
  assert.match(user, /search_tracks/);
  assert.match(user, /at most one search per block/);
  assert.ok(!user.includes('daily_recommend'));
});

test('未知 mood 退回那一格自己的曲风，不崩', () => {
  const { user } = planPrompt(CTX, [{ start: '00:00', end: '06:00', mood: 'dawn', genres: ['folk'] }]);
  assert.match(user, /00:00-06:00 dawn: folk/);
});
// 口播长度写在两个地方：system prompt 与 emit_show 的工具描述。改一处忘另一处，
// 模型会同时收到两条互相矛盾的长度约束 —— 这条钉住它们说的是同一件事（用户要 15-20 秒）。
test('口播长度在两处说同一件事：40-55 words / 15-20 秒', () => {
  const spec = TOOLS.find((tool) => tool.name === 'emit_show');
  assert.ok(spec !== undefined, 'emit_show 必须在工具表里');
  const pairs = [
    ['system prompt', systemPrompt(CTX)],
    ['emit_show', spec.parameters.properties.say.description],
  ];
  for (const [where, text] of pairs) {
    assert.match(text, /40-55 words/, where + ' 少了字数');
    assert.match(text, /15-20 seconds/, where + ' 少了秒数');
  }
});
