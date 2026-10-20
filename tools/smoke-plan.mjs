#!/usr/bin/env node
// 排表那一轮的真 key 冒烟（ADR-0030）：真模型 + 一份**假的**日推候选池，
// 验证它会先调 daily_recommend 拿候选，再用真的 id 交一份 emit_plan。
// 走的是 buildDayPlan + curate 那条真实接线 —— 与 core/radio.ts 的接法同一个。
// CI 里不跑（要 key、要花钱）；这是给人手工验收用的。
//
// 用法：
//   node --experimental-strip-types tools/smoke-plan.mjs --key-file <path>
//   LLM_API_KEY=... node --experimental-strip-types tools/smoke-plan.mjs
// 「真数据」模式（CI 里不跑：要 cookie、要能起内置网易云服务）：
//   node --experimental-strip-types tools/smoke-plan.mjs --live --cookie-file <path> --key-file <path>
// 可选：--base-url= --model=
//
// 规矩：这个脚本**永远不打印 key** —— key 只进 provider，不进任何一行输出。
import { readFileSync } from 'node:fs';
import { keyFromText } from './key-file.mjs';
import { createOpenAiLlm } from '../core/providers/llm-openai.ts';
import { ToolLoopBrain } from '../core/brain/index.ts';
import { MemoryStore } from '../core/state/memory-store.ts';
import { defaultHttpFetch } from '../core/http.ts';
import { createNeteaseSource } from '../core/music/netease.ts';
import { startNeteaseService } from '../main/netease-service.ts';
import { buildDayPlan } from '../core/plan.ts';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const live = process.argv.includes('--live');

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
const fakeMusic = {
  id: 'fake-daily',
  recommend: async (_seed, limit) => POOL.slice(0, limit),
  search: async (keywords, limit) => POOL.filter((t) => t.title.toLowerCase().includes(String(keywords).toLowerCase())).slice(0, limit),
  resolve: async () => null,
};

/**
 * --live：把假候选池换成**真的**内置网易云服务。服务由内核自己那份代码拉起
 * （main/netease-service.ts），所以验的就是「下载即用」那条路上的真数据。
 * 日推要登录，所以 --live 必须配 --cookie-file。
 */
const requests = [];
let music = fakeMusic;
let stopMusic = () => {};
if (live) {
  const cookieFile = arg('cookie-file', '');
  const cookie = cookieFile === '' ? '' : readFileSync(cookieFile, 'utf8').trim();
  if (cookie === '') { console.error('✗ --live 要 --cookie-file=<path>：日推需要登录。'); process.exit(1); }
  const service = await startNeteaseService({ dir: arg('netease-dir', 'vendor/netease'), warn: (m) => console.log('· ' + m) });
  if (service === null) { console.error('✗ 内置网易云服务没起来'); process.exit(1); }
  console.log('· 内置网易云服务 ' + service.baseUrl);
  stopMusic = () => service.stop();
  const trace = async (request) => { requests.push(request.url.replace(service.baseUrl, '')); return defaultHttpFetch(request); };
  music = createNeteaseSource({ baseUrl: service.baseUrl, cookie, fetch: trace });
}

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
if (requests.length > 0) {
  console.log('\n音乐源请求 ' + requests.length + ' 次：');
  for (const url of requests) console.log('    ' + url);
}
stopMusic();