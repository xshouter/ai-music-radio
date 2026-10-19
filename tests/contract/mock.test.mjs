// 契约测试：只断言**结构与枚举取值**，不断言 fixture 内容（需求·假设 4 —— 内容是 fixture，随便改）。
// 同一组断言将来也打真 server：设 RADIO_BASE_URL=http://127.0.0.1:<port> 即跳过启动 mock。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createMockServer } from '../../mock/server.mjs';

const DJ_STATES = ['idle', 'thinking', 'speaking'];
const ERROR_CODES = ['NO_LLM_KEY', 'MUSIC_SOURCE_UNREACHABLE', 'MUSIC_NOT_RESOLVABLE', 'TTS_FAILED', 'RATE_LIMITED', 'INTERNAL'];

let server = null;
let base = process.env.RADIO_BASE_URL ?? '';

before(async () => {
  if (base) return;
  server = createMockServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, init) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

const set = (patch) => api('/__mock/control', { method: 'POST', body: JSON.stringify(patch) });
const reset = () => set({ degraded: false, error: null });

const isRef = (value, where) => {
  assert.equal(typeof value?.id, 'string', `${where}.id`);
  assert.equal(typeof value?.title, 'string', `${where}.title`);
  assert.equal(typeof value?.artist, 'string', `${where}.artist`);
};

test('GET /api/now 返回 NowPlaying 形状', async () => {
  await reset();
  const { status, body } = await api('/api/now');
  assert.equal(status, 200);
  assert.ok(body.track === null || typeof body.track === 'object');
  assert.ok(DJ_STATES.includes(body.djState), `djState=${body.djState}`);
  assert.ok(body.startedAt === null || typeof body.startedAt === 'string');
  assert.equal(typeof body.onAir, 'boolean');
  assert.equal(typeof body.degraded, 'boolean');
});

test('POST /api/chat 返回 Show；play 一次给一批 3–6 首（ADR-0001）', async () => {
  const { status, body } = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'something quiet' }) });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.say) && body.say.length > 0);
  body.say.forEach((line) => assert.equal(typeof line, 'string'));
  assert.ok(Array.isArray(body.play));
  assert.ok(body.play.length >= 3 && body.play.length <= 6, `play.length=${body.play.length}`);
  body.play.forEach((r, i) => isRef(r, `play[${i}]`));
  assert.equal(typeof body.reason, 'string');
  assert.ok(body.segue === null || typeof body.segue === 'string');
});

test('GET /api/next 返回 TrackRef[]', async () => {
  const { status, body } = await api('/api/next');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body) && body.length > 0);
  body.forEach((r, i) => isRef(r, `next[${i}]`));
});

test('GET /api/taste 返回 4 份语料原文 + 结构化更新（ADR-0004）', async () => {
  const { status, body } = await api('/api/taste');
  assert.equal(status, 200);
  assert.equal(body.corpus.length, 4);
  body.corpus.forEach((doc) => {
    assert.equal(typeof doc.name, 'string');
    assert.equal(typeof doc.text, 'string');
  });
  assert.ok(Array.isArray(body.recent));
  body.recent.forEach((u) => {
    assert.equal(typeof u.ts, 'string');
    assert.equal(typeof u.text, 'string');
    assert.equal(typeof u.evidence, 'object');
  });
});

test('GET /api/plan/today 与 POST /api/plan/regenerate 返回 DayPlan（3 段）', async () => {
  const today = await api('/api/plan/today');
  assert.equal(today.status, 200);
  assert.equal(today.body.blocks.length, 3);
  today.body.blocks.forEach((block, i) => {
    assert.equal(typeof block.mood, 'string');
    assert.ok(Array.isArray(block.genres));
    assert.ok(Array.isArray(block.tracks));
    block.tracks.forEach((r, j) => isRef(r, `blocks[${i}].tracks[${j}]`));
  });
  const regen = await api('/api/plan/regenerate', { method: 'POST', body: JSON.stringify({ reason: 'mood shift' }) });
  assert.equal(regen.status, 200);
  assert.equal(typeof regen.body.date, 'string');
  assert.equal(typeof regen.body.active, 'boolean');
});

test('GET /api/lyric/:songId 返回 Lyric | null', async () => {
  const known = await api('/api/lyric/n1001');
  assert.equal(known.status, 200);
  assert.equal(typeof known.body.lrc, 'string');
  const unknown = await api('/api/lyric/does-not-exist');
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body, null);
});

test('音频：200 全量 / 206 分段，且是内存生成的 WAV', async () => {
  const full = await fetch(`${base}/api/audio/n1001`);
  assert.equal(full.status, 200);
  assert.match(full.headers.get('content-type'), /^audio\//);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.ok(bytes.length > 44);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');

  const part = await fetch(`${base}/api/audio/n1001`, { headers: { range: 'bytes=0-99' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-99/${bytes.length}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);

  const tts = await fetch(`${base}/tts/deadbeef.mp3`);
  assert.equal(tts.status, 200);
  assert.ok((await tts.arrayBuffer()).byteLength > 44);
});

test('POST /api/playback 返回 { ok: true }', async () => {
  const { status, body } = await api('/api/playback', {
    method: 'POST',
    body: JSON.stringify({ songId: 'n1001', event: 'started', at: new Date().toISOString() }),
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('/api/settings 只回显「是否已配置」，明文 key 永不回显', async () => {
  const before_ = await api('/api/settings');
  assert.equal(before_.status, 200);
  assert.equal(typeof before_.body.llm.baseUrl, 'string');
  assert.equal(typeof before_.body.llm.apiKeySet, 'boolean');
  assert.ok(['openai', 'anthropic'].includes(before_.body.llm.protocol));

  const secret = 'sk-should-never-come-back';
  const put = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ llm: { apiKey: secret, model: 'qwen-max' } }) });
  assert.equal(put.status, 200);
  assert.equal(put.body.llm.apiKeySet, true);
  assert.equal(put.body.llm.model, 'qwen-max');
  const raw = JSON.stringify(put.body);
  assert.ok(!raw.includes(secret), '响应里出现了明文 key');
  assert.ok(!raw.includes('"apiKey"'), '响应里出现了 apiKey 字段');
});

test('一个开关切到 degraded，队列随之只剩能解析的', async () => {
  await set({ degraded: true });
  const now = await api('/api/now');
  assert.equal(now.body.degraded, true);
  const queue = await api('/api/next');
  assert.ok(queue.body.length > 0);
  assert.ok(queue.body.every((r) => r.id.startsWith('l')), '降级后队列应只剩本地兜底');
  await reset();
  assert.equal((await api('/api/now')).body.degraded, false);
});

test('每个错误码都能单独触发，且是统一信封', async () => {
  for (const code of ERROR_CODES) {
    assert.equal((await set({ error: code })).status, 200);
    const { status, body } = await api('/api/now');
    assert.notEqual(status, 200, `${code} 应该返回非 200`);
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.message, 'string');
    assert.equal(typeof body.error.retryable, 'boolean');
  }
  await reset();
  assert.equal((await api('/api/now')).status, 200);
});

test('错误注入不影响音频路径（单点失败不许把音乐停掉）', async () => {
  await set({ error: 'MUSIC_SOURCE_UNREACHABLE' });
  const audio = await fetch(`${base}/api/audio/n1001`);
  assert.equal(audio.status, 200);
  await reset();
});

test('未知路径也走统一信封', async () => {
  const { status, body } = await api('/api/nope');
  assert.equal(status, 404);
  assert.ok(ERROR_CODES.includes(body.error.code));
});

// —— WS ——
function openWs(path) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({
      host: url.hostname,
      port: url.port,
      path,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
      },
    });
    req.on('upgrade', (_res, socket, head) => resolve({ socket, head }));
    req.on('response', (res) => reject(new Error(`没有升级成 WS：${res.statusCode}`)));
    req.on('error', reject);
    req.end();
  });
}

/** 服务端帧不带 mask（协议如此），所以解析很简单。 */
function frameReader(onEvent) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (opcode === 0x1) {
        try { onEvent(JSON.parse(payload.toString('utf8'))); } catch { /* 半个帧或坏帧，忽略 */ }
      } else if (opcode === 0x8) {
        return;
      }
    }
  };
}

test('WS /stream：连上先给快照，chat 的口播逐句推而不是一次发完', async (t) => {
  await reset();
  const events = [];
  const { socket, head } = await openWs('/stream');
  // 服务端把 101 与第一批帧写在同一个 TCP 段里，多出来的字节会作为 head 交给客户端；
  // 不管 head 就会丢掉快照事件，而且断言一失败 socket 泄漏，server.close() 会永远等下去（踩过）。
  t.after(() => socket.destroy());
  const read = frameReader((event) => events.push(event));
  if (head?.length) read(head);
  socket.on('data', read);
  await sleep(250);

  const snapshotTypes = events.map((e) => e.type);
  for (const type of ['now', 'queue', 'plan', 'state']) {
    assert.ok(snapshotTypes.includes(type), `缺少 ${type} 快照事件`);
  }

  events.length = 0;
  await api('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'go on then' }) });
  await sleep(900);

  const says = events.filter((e) => e.type === 'say');
  assert.ok(says.length >= 2, 'say 必须是逐句的多条事件，不能是一条整段（需求·假设 2）');
  says.forEach((event, index) => {
    assert.equal(event.payload.index, index);
    assert.equal(typeof event.payload.line, 'string');
  });
  assert.ok(events.some((e) => e.type === 'state'), '结束时要回到 idle');
});