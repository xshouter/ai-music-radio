#!/usr/bin/env node
// 真 key 冒烟：把大脑接上一次**真**补全，证明"任何兼容 key 都能用"不是一句口号。
// CI 里不跑（没有 key，也不该烧钱）；这是给人手工验收用的。
//
// 用法：
//   node --experimental-strip-types tools/smoke-llm.mjs --key-file <path>
//   LLM_API_KEY=... node --experimental-strip-types tools/smoke-llm.mjs
// 可选：--base-url= --model= --protocol=openai|anthropic
// 从文件里怎么把 key 抽出来（含带点的 key），见 tools/key-file.mjs —— 它有自己的测试。
//
// 规矩：这个脚本**永远不打印 key**，任何输出都先过一遍 mask()。
import { readFileSync } from 'node:fs';
import { keyFromText } from './key-file.mjs';
import { createOpenAiLlm } from '../core/providers/llm-openai.ts';
import { createAnthropicLlm } from '../core/providers/llm-anthropic.ts';
import { ToolLoopBrain } from '../core/brain/index.ts';
import { MemoryStore } from '../core/state/memory-store.ts';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const readKey = () => {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY.trim();
  // 不给默认路径：这里曾经写死一个作者本机的桌面路径（公开仓库里不该有那个）。
  const file = arg('key-file', '');
  if (file === '') return '';
  try {
    return keyFromText(readFileSync(file, 'utf8'));
  } catch {
    return '';
  }
};

const CATALOG = [
  { id: 'n1001', title: 'Midnight Drive', artist: 'The Long Way', source: 'netease' },
  { id: 'n1002', title: 'Neon Hours', artist: 'Kite & Ash', source: 'netease' },
  { id: 'n1003', title: 'Slow Static', artist: 'Marina Vale', source: 'netease' },
  { id: 'n1004', title: 'Paper Lungs', artist: 'The Long Way', source: 'netease' },
  { id: 'n1005', title: 'Harbour Lights', artist: 'Kite & Ash', source: 'netease' },
  { id: 'n1006', title: 'Half a Morning', artist: 'Ivo Sand', source: 'netease' },
  { id: 'n1007', title: 'Cassette Weather', artist: 'Marina Vale', source: 'netease' },
  { id: 'n1008', title: 'Blue Hour Radio', artist: 'Ivo Sand', source: 'netease' },
];

const key = readKey();
const mask = (text) => String(text).split(key).join(key === '' ? '' : '***');
if (key === '') {
  console.error('✗ 没有拿到 key。用 --key-file=<path> 或 LLM_API_KEY=... 给一个。');
  process.exit(1);
}

const protocol = arg('protocol', 'openai');
const baseUrl = arg('base-url', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
const model = arg('model', 'qwen-plus');
const llm = protocol === 'anthropic'
  ? createAnthropicLlm({ baseUrl, apiKey: key })
  : createOpenAiLlm({ baseUrl, apiKey: key });

const now = new Date();
const store = new MemoryStore({ now: () => now });
const played = { songId: 'n1004', title: 'Paper Lungs', artist: 'The Long Way', source: 'netease', level: 'exhigh', startedAt: new Date(now.getTime() - 60000).toISOString(), reason: null };
await store.recordPlay({ ...played, ts: played.startedAt, endedAt: null, skipped: false });
await store.recordPlay({ ...played, ts: now.toISOString(), endedAt: now.toISOString(), skipped: true });

const steps = [];
const brain = new ToolLoopBrain({
  llm,
  model,
  store,
  taste: {
    read: async () => ({
      genres: ['ambient', 'downtempo'],
      corpus: [
        { name: 'taste.md', text: 'Warm synth, nothing fast. If I ask for focus, drop the vocals entirely.' },
        { name: 'notes.md', text: 'No algorithm. I want to hear someone deciding.' },
      ],
      recent: [],
    }),
    appendLearned: async () => {},
  },
  env: { weather: async () => ({ tempC: 12, text: 'light rain' }), calendar: async () => [] },
  music: {
    id: 'smoke-stub',
    recommend: async (_seed, limit) => CATALOG.slice(0, limit),
    search: async (keywords, limit) => CATALOG.filter((t) => (t.title + t.artist).toLowerCase().includes(keywords.toLowerCase())).slice(0, limit),
    resolve: async () => null,
  },
  onStep: (step) => steps.push(step),
});

console.log('→ ' + protocol + ' · ' + baseUrl + ' · ' + model + ' · key ' + key.slice(0, 3) + '…(' + key.length + ')');
try {
  const show = await brain.think({ trigger: 'schedule', now });
  console.log('✓ 工具轨迹：' + (steps.map((s) => s.tool).join(' → ') || '(无，正文直出)'));
  console.log('✓ say:');
  for (const line of show.say) console.log('    ' + line);
  console.log('✓ play: ' + show.play.map((t) => t.title + ' — ' + t.artist).join(' | '));
  console.log('✓ reason: ' + show.reason);
  console.log('✓ segue: ' + (show.segue === null ? '(null)' : show.segue));
  console.log('✓ 冒烟通过');
} catch (error) {
  console.error('✗ 冒烟失败：' + mask(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}