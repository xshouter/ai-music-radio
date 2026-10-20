#!/usr/bin/env node
// 排表那一轮的真 key 冒烟（ADR-0030）：真模型 + 一份**假的**日推候选池，
// 验证它会先调 daily_recommend 拿候选，再用真的 id 交一份 emit_plan。
// 走的是 buildDayPlan + curate 那条真实接线 —— 与 core/radio.ts 的接法同一个。
// CI 里不跑（要 key、要花钱）；这是给人手工验收用的。
//
// 用法：
//   node --experimental-strip-types tools/smoke-plan.mjs --key-file <path>
//   LLM_API_KEY=... node --experimental-strip-types tools/smoke-plan.mjs
// 可选：--base-url= --model=
//
// 规矩：这个脚本**永远不打印 key** —— key 只进 provider，不进任何一行输出。
import { readFileSync } from 'node:fs';
import { keyFromText } from './key-file.mjs';
import { createOpenAiLlm } from '../core/providers/llm-openai.ts';
import { ToolLoopBrain } from '../core/brain/index.ts';
import { MemoryStore } from '../core/state/memory-store.ts';
import { buildDayPlan } from '../core/plan.ts';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const key = process.env.LLM_API_KEY?.trim() || (() => {
  const file = arg('key-file', '');
  if (file === '') return '';
  try { return keyFromText(readFileSync(file, 'utf8')); } catch { return ''; }
})();
if (key === '') { console.error('✗ 没拿到 key：用 --key-file=<path> 或 LLM_API_KEY=...'); process.exit(1); }

const llm = createOpenAiLlm({ baseUrl: arg('base-url', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), apiKey: key });
const model = arg('model', 'qwen-plus');
const now = new Date();

// 假的日推：30 首，标题里带氛围词 —— 人眼一看就知道模型有没有按三格挑。
const MOODS = ['acoustic', 'jazz', 'indie-pop', 'electronic', 'ambient', 'synthwave'];
const POOL = Array.from({ length: 30 }, (_, i) => ({
  id: 'd' + String(1000 + i),
  title: MOODS[i % MOODS.length] + ' ' + (i + 1),
  artist: 'Pool Artist ' + ((i % 7) + 1),
  source: 'fake-daily',
}));
const music = {
  id: 'fake-daily',
  recommend: async (_seed, limit) => POOL.slice(0, limit),
  search: async (keywords, limit) => POOL.filter((t) => t.title.toLowerCase().includes(String(keywords).toLowerCase())).slice(0, limit),
  resolve: async () => null,
};

const store = new MemoryStore({ now: () => now });
const taste = {
  read: async () => ({ genres: ['ambient', 'jazz'], corpus: [{ name: 'taste.md', text: 'Nothing fast after 23:00. Warm, low, unhurried.' }], recent: [] }),
  appendLearned: async () => {},
};
const env = { weather: async () => ({ tempC: 12, text: 'rain' }), calendar: async () => [] };

const steps = [];
const brain = new ToolLoopBrain({
  llm, music, store, taste, env, model,
  onStep: (step) => { steps.push(step); console.log('· tool ' + step.tool + ' → ' + JSON.stringify(step.result).slice(0, 120)); },
});

const started = Date.now();
const plan = await buildDayPlan({
  date: now.toISOString().slice(0, 10),
  createdAt: now.toISOString(),
  music,
  curate: async (blocks) => brain.plan({ trigger: 'schedule', now }, blocks),
});

console.log('\n用时 ' + Math.round((Date.now() - started) / 1000) + 's · 模型 ' + model + ' · 工具调用 ' + steps.length + ' 次');
for (const block of plan.blocks) {
  console.log('\n' + block.start + '-' + block.end + '  ' + block.mood + '  [' + block.genres.join(', ') + ']  ' + block.tracks.length + ' 首');
  for (const track of block.tracks) console.log('    ' + track.id + '  ' + track.title + ' — ' + track.artist);
}