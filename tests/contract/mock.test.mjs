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

// ADR-0009 的删除已落地：这条不是「不测了」，而是把「消失」本身钉住。
test('歌词端点已经不存在（ADR-0009 的债已还）', async () => {
  const gone = await api('/api/lyric/n1001');
  assert.equal(gone.status, 404, '歌词端点必须真的消失，而不是留一个没人调的出口');
  assert.equal(gone.body.error.code, 'INTERNAL', '封闭枚举里没有 NOT_FOUND，未知路径沿用 INTERNAL');
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

test('GET /api/favorites 返回 TrackRef[]（ADR-0010）', async () => {
  await reset();
  const { status, body } = await api('/api/favorites');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body) && body.length > 0);
  body.forEach((r, i) => isRef(r, `favorites[${i}]`));
});

test('POST /api/feedback 能加能删，GET 立刻反映，且两个动作都幂等（ADR-0010）', async () => {
  await reset();
  const fb = (action) => api('/api/feedback', { method: 'POST', body: JSON.stringify({ songId: 'n1001', action }) });
  const ids = async () => (await api('/api/favorites')).body.map((r) => r.id);

  assert.equal((await fb('like')).body.ok, true, 'like 要回 { ok: true }');
  assert.ok((await ids()).includes('n1001'), 'like 之后列表里要有它');
  assert.equal((await fb('like')).body.ok, true, '重复 like 必须幂等');
  assert.equal((await ids()).filter((id) => id === 'n1001').length, 1, '幂等：不许出现两条');

  assert.equal((await fb('unlike')).body.ok, true);
  assert.ok(!(await ids()).includes('n1001'), 'unlike 之后列表里不许有它');
  assert.equal((await fb('unlike')).body.ok, true, '重复 unlike 必须幂等');
});

test('POST /api/feedback 只认封闭枚举里的 action，未知曲目不许静默成功', async () => {
  await reset();
  const badAction = await api('/api/feedback', { method: 'POST', body: JSON.stringify({ songId: 'n1001', action: 'love' }) });
  assert.equal(badAction.status, 400, 'action 不在枚举里要 400，不能悄悄当成 like');
  assert.equal(badAction.body.error.code, 'INTERNAL', '封闭枚举里没有更贴切的码');
  const ghost = await api('/api/feedback', { method: 'POST', body: JSON.stringify({ songId: 'does-not-exist', action: 'like' }) });
  assert.equal(ghost.status, 400, '不认识的曲目要报错，不许静默 ok');
});

test('GET /api/taste 的 genres 是数据不是装饰（ADR-0010）', async () => {
  const { status, body } = await api('/api/taste');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.genres) && body.genres.length >= 3, 'DJ 详情的曲风胶囊要有数据来源');
  body.genres.forEach((g) => assert.equal(typeof g, 'string'));
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

  // ADR-0011：网易云 cookie 与 apiKey 受同一套禁令保护。
  const cookie = 'MUSIC_U=should-never-come-back; __csrf=also-secret';
  const putMusic = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ music: { provider: 'netease', cookie } }) });
  assert.equal(putMusic.status, 200);
  assert.equal(putMusic.body.music.cookieSet, true);
  assert.equal(putMusic.body.music.provider, 'netease');
  const rawMusic = JSON.stringify(putMusic.body);
  assert.ok(!rawMusic.includes('should-never-come-back'), '响应里出现了 cookie 明文');
  assert.ok(!rawMusic.includes('also-secret'), '响应里出现了 __csrf 明文');
  assert.ok(!rawMusic.includes('MUSIC_U'), '响应里出现了 MUSIC_U');
  assert.ok(!rawMusic.includes('"cookie"'), '响应里出现了 cookie 字段');
  const settingsAfter = await api('/api/settings');
  assert.equal(settingsAfter.body.music.cookieSet, true, 'GET 也要说「配了」，但同样不给值');
  assert.ok(!JSON.stringify(settingsAfter.body).includes('should-never-come-back'));
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

test('WS /stream：连上先给快照（并开口），chat 的口播逐句推而不是一次发完', async (t) => {
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

  // 连上时 DJ 就会开口（「一开机我就打碟」）：等开场那几句推完，再清零数这一轮的。
  await sleep(400);
  events.length = 0;
  await api('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'go on then' }) });
  await sleep(900);

  const says = events.filter((e) => e.type === 'say');
  assert.ok(says.length >= 2, 'say 必须是逐句的多条事件，不能是一条整段（需求·假设 2）');
  says.forEach((event, index) => {
    assert.equal(event.payload.index, index);
    assert.equal(typeof event.payload.line, 'string');
    // ADR-0012：一句口播自带音频与词级时间戳，否则 UI 没法逐词高亮 / 算口播进度。
    assert.equal(typeof event.payload.audioUrl, 'string');
    assert.ok(event.payload.audioUrl.startsWith('/tts/'), 'audioUrl 走 /tts/');
    assert.ok(Array.isArray(event.payload.words) && event.payload.words.length > 0);
    let at = 0;
    for (const word of event.payload.words) {
      assert.equal(typeof word.text, 'string');
      assert.ok(word.startMs >= at, '词时间戳要单调、不重叠');
      assert.ok(word.endMs > word.startMs, '每个词要有正的长度');
      at = word.endMs;
    }
    assert.equal(event.payload.words.map((w) => w.text).join(' '), event.payload.line, '时间戳要能拼回原句');
  });

  // 这一句的音频真的取得到，而且长度就等于词时间戳的长度（高亮与音频必须同源）。
  const last = says[says.length - 1].payload;
  const tts = await fetch(base + last.audioUrl);
  assert.equal(tts.status, 200);
  assert.ok((tts.headers.get('content-type') ?? '').startsWith('audio/'));
  const wav = Buffer.from(await tts.arrayBuffer());
  assert.ok(Math.abs(wav.readUInt32LE(40) / 16000 - last.words.at(-1).endMs / 1000) < 0.05, '音频长度要等于口播时长');
  assert.ok(events.some((e) => e.type === 'state'), '结束时要回到 idle');
});