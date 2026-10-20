// 4.2 的自检：tool loop 的行为、两个适配器的协议翻译。
// 联网不该是测试的前提 —— 翻译的正确性靠脚本化的 fetch 钉死；真 key 只用来做手工冒烟。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolLoopBrain, TOOLS } from '../../core/brain/index.ts';
import { createOpenAiLlm } from '../../core/providers/llm-openai.ts';
import { createAnthropicLlm, toAnthropicMessages } from '../../core/providers/llm-anthropic.ts';
import { HttpError } from '../../core/http.ts';
import { MemoryStore } from '../../core/state/memory-store.ts';

const CATALOG = [
  { id: 'n1001', title: 'Midnight Drive', artist: 'The Long Way', source: 'netease' },
  { id: 'n1002', title: 'Neon Hours', artist: 'Kite & Ash', source: 'netease' },
  { id: 'n1003', title: 'Slow Static', artist: 'Marina Vale', source: 'netease' },
  { id: 'n1004', title: 'Paper Lungs', artist: 'The Long Way', source: 'netease' },
  { id: 'n1005', title: 'Harbour Lights', artist: 'Kite & Ash', source: 'netease' },
];

const NOW = new Date('2026-10-20T22:10:00.000Z');

const ref = (t) => ({ id: t.id, title: t.title, artist: t.artist });
const call = (id, name, args) => ({ id, name, args });
const reply = (toolCalls, text = '') => ({ text, toolCalls, finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop' });

function scripted(responses) {
  const requests = [];
  let index = 0;
  return {
    requests,
    id: 'scripted',
    async complete(request) {
      requests.push(request);
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return typeof next === 'function' ? next(request) : next;
    },
  };
}

function makeBrain({ llm, music, store, env }) {
  const steps = [];
  const brain = new ToolLoopBrain({
    llm,
    model: 'test-model',
    store: store ?? new MemoryStore({ now: () => NOW }),
    taste: {
      read: async () => ({ genres: ['ambient'], corpus: [{ name: 'taste.md', text: 'Nothing fast after 23:00.' }], recent: [] }),
      appendLearned: async () => {},
    },
    env: env ?? { weather: async () => ({ tempC: 11, text: 'rain' }), calendar: async () => [] },
    music: music ?? {
      id: 'fake',
      recommend: async (_seed, limit) => CATALOG.slice(0, limit),
      search: async (keywords, limit) => CATALOG.filter((t) => (t.title + t.artist).toLowerCase().includes(keywords.toLowerCase())).slice(0, limit),
      resolve: async () => null,
    },
    onStep: (step) => steps.push(step),
  });
  return { brain, steps };
}

const emit = (args) => reply([call('c9', 'emit_show', args)]);

test('一轮完整推理：先取候选，再定稿；工具结果原样回到模型手里', async () => {
  const llm = scripted([
    reply([call('c1', 'recommend_tracks', { mood: 'low and steady', limit: 4 })]),
    emit({ say: ['Evening. Warm synth, nothing fast.', 'Stay low.'], play: ['n1003', 'n1001', 'n1004'], reason: 'Low and steady, matching the rain.', segue: 'No vocals for a minute.' }),
  ]);
  const { brain, steps } = makeBrain({ llm });
  const show = await brain.think({ trigger: 'schedule', now: NOW });

  assert.deepEqual(show.say, ['Evening. Warm synth, nothing fast.', 'Stay low.']);
  assert.deepEqual(show.play.map((t) => t.id), ['n1003', 'n1001', 'n1004']);
  assert.deepEqual(show.play[0], ref(CATALOG[2]));
  assert.equal(show.reason, 'Low and steady, matching the rain.');
  assert.equal(show.segue, 'No vocals for a minute.');
  assert.deepEqual(steps.map((s) => s.tool), ['recommend_tracks']);

  // 第二次请求必须带上：上一轮的 assistant(tool_calls) + 一条 tool 结果。
  const second = llm.requests[1].messages;
  assert.equal(second.at(-2).role, 'assistant');
  assert.equal(second.at(-2).toolCalls[0].name, 'recommend_tracks');
  assert.equal(second.at(-1).role, 'tool');
  assert.equal(second.at(-1).toolCallId, 'c1');
  assert.deepEqual(JSON.parse(second.at(-1).content).tracks.map((t) => t.id), ['n1001', 'n1002', 'n1003', 'n1004']);
  // 提示词把人设、语料、真实播放史都带上了。
  assert.match(llm.requests[0].messages[0].content, /Nothing fast after 23:00/);
  assert.match(llm.requests[0].messages[1].content, /The block is starting/);
  // 工具集合是封闭的：四个，最后一个必须是定稿的那个。
  assert.deepEqual(TOOLS.map((t) => t.name), ['recommend_tracks', 'search_tracks', 'recent_plays', 'emit_show']);
});

test('编造的曲目 id 会被驳回，并且驳回理由原样回到模型手里（自愈的唯一入口）', async () => {
  const llm = scripted([
    reply([call('c1', 'search_tracks', { keywords: 'marina' })]),
    emit({ say: ['Here.'], play: ['ghost-999'], reason: 'because' }),
    emit({ say: ['Here.'], play: ['n1003'], reason: 'Marina, low and close.' }),
  ]);
  const { brain, steps } = makeBrain({ llm });
  const show = await brain.think({ trigger: 'chat', userText: 'something quiet', now: NOW });

  assert.deepEqual(show.play.map((t) => t.id), ['n1003']);
  assert.equal(show.reason, 'Marina, low and close.');
  const toolMessages = llm.requests[2].messages.filter((m) => m.role === 'tool');
  const rejection = toolMessages.find((m) => m.content.includes('emit_show rejected'));
  assert.ok(rejection, '驳回理由必须作为 tool 结果回到模型手里');
  assert.match(rejection.content, /ghost-999/);
  assert.equal(steps.filter((s) => s.tool === 'emit_show').length, 1);
});

test('工具抛错不炸整轮：错误当结果交回去，模型换个工具照样定稿', async () => {
  const llm = scripted([
    reply([call('c1', 'recommend_tracks', {})]),
    reply([call('c2', 'search_tracks', { keywords: 'kite' })]),
    emit({ say: ['Nothing new, so we stay.'], play: ['n1002', 'n1005'], reason: 'Fallback set.' }),
  ]);
  const { brain, steps } = makeBrain({
    llm,
    music: {
      id: 'broken',
      recommend: async () => { throw new Error('MUSIC_SOURCE_UNREACHABLE'); },
      search: async (keywords, limit) => CATALOG.filter((t) => (t.title + t.artist).toLowerCase().includes(keywords.toLowerCase())).slice(0, limit),
      resolve: async () => null,
    },
  });
  const show = await brain.think({ trigger: 'manual', now: NOW });
  assert.deepEqual(show.play.map((t) => t.id), ['n1002', 'n1005']);
  assert.match(JSON.stringify(steps[0].result), /MUSIC_SOURCE_UNREACHABLE/);
});

test('模型不用工具、把 JSON 写进正文时也认，但走同一套校验', async () => {
  const good = scripted([
    reply([call('c1', 'recommend_tracks', { limit: 5 })]),
    reply([], 'Sure: {"say":["Quiet set."],"play":["n1001","n1003","n1004"],"reason":"low"}'),
  ]);
  const fromText = await makeBrain({ llm: good }).brain.think({ trigger: 'schedule', now: NOW });
  assert.deepEqual(fromText.play.map((t) => t.id), ['n1001', 'n1003', 'n1004']);
  assert.equal(fromText.reason, 'low');

  // 正文里的 JSON 一样不许编 id、一样要有 reason —— 校验只有一份，路径不同不走样。
  const bad = scripted([
    reply([call('c1', 'recommend_tracks', { limit: 5 })]),
    reply([], '{"say":["Nope."],"play":["ghost"],"reason":"x"}'),
    emit({ say: ['Fine.'], play: ['n1001', 'n1002', 'n1003'], reason: 'ok' }),
  ]);
  const healed = await makeBrain({ llm: bad }).brain.think({ trigger: 'schedule', now: NOW });
  assert.deepEqual(healed.play.map((t) => t.id), ['n1001', 'n1002', 'n1003']);
});

test('步数耗尽就抛错，不假装成功（不静默返回一个空 Show）', async () => {
  const llm = scripted([reply([call('c1', 'recent_plays', {})])]);
  await assert.rejects(
    () => makeBrain({ llm }).brain.think({ trigger: 'track_end', now: NOW }),
    /step budget exhausted/,
  );
  assert.equal(llm.requests.length, 6, 'maxSteps 一次用满');
  assert.deepEqual(llm.requests[5].toolChoice, { name: 'emit_show' }, '最后一步强制定稿');
  assert.equal(llm.requests[0].toolChoice, 'auto');
});

const capture = (payload, status = 200) => {
  const calls = [];
  const fetch = async (request) => {
    calls.push({ url: request.url, headers: request.headers, body: JSON.parse(request.body) });
    return { status, text: async () => JSON.stringify(payload) };
  };
  return { fetch, calls };
};

test('OpenAI 适配器：tool_calls 的 arguments 是 JSON 字符串，tool 结果走 tool_call_id', async () => {
  const { fetch, calls } = capture({
    choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'recent_plays', arguments: '{"limit":3}' } }] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 120, completion_tokens: 8 },
  });
  const llm = createOpenAiLlm({ baseUrl: 'https://example.test/v1/', apiKey: 'sk-test', fetch });
  const response = await llm.complete({
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [call('c0', 'recommend_tracks', { limit: 3 })] },
      { role: 'tool', toolCallId: 'c0', content: '{"tracks":[]}' },
    ],
    tools: [TOOLS[0]],
    toolChoice: { name: 'emit_show' },
  });

  assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test');
  assert.equal(calls[0].body.tool_choice.function.name, 'emit_show');
  assert.equal(calls[0].body.tools[0].type, 'function');
  assert.equal(calls[0].body.messages[2].tool_calls[0].function.arguments, '{"limit":3}');
  assert.equal(calls[0].body.messages[3].tool_call_id, 'c0');
  assert.deepEqual(response, {
    text: '', toolCalls: [call('c1', 'recent_plays', { limit: 3 })], finishReason: 'tool_calls',
    usage: { inputTokens: 120, outputTokens: 8 },
  });
});

test('Anthropic 适配器：system 提到顶层、连续的 tool 结果合并成一条 user 消息', async () => {
  const { system, messages } = toAnthropicMessages([
    { role: 'system', content: 'sys-a' },
    { role: 'system', content: 'sys-b' },
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', toolCalls: [call('c1', 'a', {}), call('c2', 'b', {})] },
    { role: 'tool', toolCallId: 'c1', content: 'one' },
    { role: 'tool', toolCallId: 'c2', content: 'two' },
  ]);
  assert.equal(system, 'sys-a\n\nsys-b');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(messages[1].content.map((b) => b.type), ['tool_use', 'tool_use']);
  assert.deepEqual(messages[2].content.map((b) => b.type), ['tool_result', 'tool_result']);
  assert.deepEqual(messages[2].content.map((b) => b.tool_use_id), ['c1', 'c2']);

  const { fetch, calls } = capture({
    content: [{ type: 'text', text: 'Quiet set.' }, { type: 'tool_use', id: 'c9', name: 'emit_show', input: { say: ['x'] } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 9, output_tokens: 4 },
  });
  const llm = createAnthropicLlm({ baseUrl: 'https://api.anthropic.test', apiKey: 'sk-ant', fetch });
  const response = await llm.complete({ model: 'claude-x', messages: [{ role: 'user', content: 'go' }], tools: [TOOLS[0]], toolChoice: 'required' });

  assert.equal(calls[0].url, 'https://api.anthropic.test/v1/messages');
  assert.equal(calls[0].headers['x-api-key'], 'sk-ant');
  assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0].body.max_tokens, 1024, 'Anthropic 的 max_tokens 是必填');
  assert.equal(calls[0].body.tool_choice.type, 'any');
  assert.deepEqual(calls[0].body.tools[0].input_schema, TOOLS[0].parameters);
  assert.equal(response.text, 'Quiet set.');
  assert.equal(response.finishReason, 'tool_calls');
  assert.deepEqual(response.toolCalls, [call('c9', 'emit_show', { say: ['x'] })]);
});

test('上游非 2xx 抛 HttpError 并带上状态码（429 与 401 要能分开处理）', async () => {
  const { fetch } = capture({ error: { message: 'rate limited' } }, 429);
  const llm = createOpenAiLlm({ baseUrl: 'https://example.test/v1', apiKey: 'sk-test', fetch });
  await assert.rejects(
    () => llm.complete({ model: 'm', messages: [{ role: 'user', content: 'go' }] }),
    (error) => error instanceof HttpError && error.status === 429,
  );
});

test('真实播放史会进 prompt：跳过过的歌，DJ 看得见', async () => {
  const store = new MemoryStore({ now: () => NOW });
  // 先 started 再收尾 —— Store 只认「收尾一条已开启的记录」，直接塞一条收尾会被丢掉（与 mock 同一套语义）。
  const played = { songId: 'n1004', title: 'Paper Lungs', artist: 'The Long Way', source: 'netease', level: 'exhigh', startedAt: '2026-10-20T21:00:00.000Z', reason: null };
  await store.recordPlay({ ...played, ts: '2026-10-20T21:00:00.000Z', endedAt: null, skipped: false });
  await store.recordPlay({ ...played, ts: '2026-10-20T21:01:00.000Z', endedAt: '2026-10-20T21:01:00.000Z', skipped: true });
  const llm = scripted([
    reply([call('c1', 'recent_plays', {})]),
    reply([call('c2', 'search_tracks', { keywords: 'marina' })]),
    emit({ say: ['Alright.'], play: ['n1003'], reason: 'r' }),
  ]);
  await makeBrain({ llm, store }).brain.think({ trigger: 'track_end', now: NOW });
  assert.match(llm.requests[0].messages[0].content, /Paper Lungs — The Long Way \(skipped\)/);
});