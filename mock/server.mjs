#!/usr/bin/env node
// EdgeRunner 假后端（阶段 2）。按 shared/api-types.ts 的第 5 节契约返回**固定 fixture**。
// 零依赖：只用 Node 内建的 http / crypto / url（Express 会引入一个依赖，且不必要）。
//
//   node mock/server.mjs                      # 127.0.0.1:8765
//   PORT=9000 node mock/server.mjs
//
// 切状态（UI 一行代码都不用改，因为控制通道**不在契约里**）：
//   GET  /__mock/control                          # 看当前状态
//   POST /__mock/control  {"degraded":true}       # 电台进入降级态，WS 立刻推新的 now
//   POST /__mock/control  {"error":"TTS_FAILED"}  # 之后所有 JSON 端点都返回该错误信封
//   POST /__mock/control  {"error":null}          # 清除
//   冷启动也可用环境变量：MOCK_DEGRADED=1 / MOCK_ERROR=NO_LLM_KEY
//
// 不校验 x-radio-token：校验是**真 server** 的事（契约第 5 节）；mock 保持宽松，方便直接 curl。
// fixture 里没有 coverUrl：仓库不放任何素材（docs/references.md）。UI 想要封面，到阶段 3 再定。

import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PORT = Number(process.env.PORT ?? 8765);

// —— fixture。内容是假的，形状是真的：契约测试只断言形状（需求·假设 4） ——
const TRACKS = [
  { id: 'n1001', title: 'Midnight Drive', artist: 'The Long Way', album: 'Neon Hours', durationMs: 214000, source: 'netease' },
  { id: 'n1002', title: 'Neon Hours', artist: 'Kite & Ash', album: 'Neon Hours', durationMs: 198000, source: 'netease' },
  { id: 'n1003', title: 'Slow Static', artist: 'Marina Vale', album: 'Quiet Machines', durationMs: 241000, source: 'netease' },
  { id: 'n1004', title: 'Paper Lungs', artist: 'The Long Way', album: 'Neon Hours', durationMs: 176000, source: 'netease' },
  { id: 'n1005', title: 'Harbour Lights', artist: 'Kite & Ash', album: 'Tide Tables', durationMs: 223000, source: 'netease' },
  { id: 'n1006', title: 'Half a Morning', artist: 'Ivo Sand', album: 'Field Notes', durationMs: 187000, source: 'netease' },
  { id: 'n1007', title: 'Cassette Weather', artist: 'Marina Vale', album: 'Quiet Machines', durationMs: 259000, source: 'netease' },
  { id: 'n1008', title: 'Blue Hour Radio', artist: 'Ivo Sand', album: 'Field Notes', durationMs: 205000, source: 'netease' },
  { id: 'l9001', title: 'Room Tone', artist: 'EdgeRunner Local', album: 'Fallback', durationMs: 300000, source: 'local' },
  { id: 'l9002', title: 'Rain on Glass', artist: 'EdgeRunner Local', album: 'Fallback', durationMs: 300000, source: 'local' },
];

const ref = ({ id, title, artist }) => ({ id, title, artist });
const byId = (id) => TRACKS.find((t) => t.id === id);

const SHOW = {
  say: [
    'It is late evening where you are, so we will keep this one slow.',
    'Starting with Midnight Drive: warm synth, nothing above a walking pace.',
    'Then Neon Hours, same mood but a shade brighter.',
    'If you want something else, just say so and I will turn the wheel.',
  ],
  play: ['n1001', 'n1002', 'n1003'].map((id) => ref(byId(id))),
  reason: 'Evening slot and low energy: warm synth, nothing above 120 BPM, no vocals that fight the room tone.',
  segue: 'Stay with me. We are drifting into the night from here.',
};

const STARTED_AT = new Date().toISOString();

const PLAN = {
  date: STARTED_AT.slice(0, 10),
  createdAt: STARTED_AT,
  active: true,
  blocks: [
    { start: '07:00', end: '12:00', mood: 'morning', genres: ['acoustic', 'jazz'], tracks: ['n1006', 'n1005', 'l9001'].map((id) => ref(byId(id))) },
    { start: '12:00', end: '18:00', mood: 'daytime', genres: ['indie-pop', 'electronic'], tracks: ['n1004', 'n1008', 'n1002'].map((id) => ref(byId(id))) },
    { start: '18:00', end: '02:00', mood: 'late-night', genres: ['ambient', 'synthwave'], tracks: ['n1001', 'n1003', 'n1007'].map((id) => ref(byId(id))) },
  ],
};

const TASTE = {
  // DJ 详情弹层里的曲风胶囊（ADR-0010）。它是数据，UI 不许写死。
  genres: ['JAZZ-HIPHOP', 'NEO-CLASSICAL', '90S 华语', 'HIP-HOP', 'BEDROOM-POP', 'J-ROCK', 'RAIN NOISE', 'POST-PUNK'],
  corpus: [
    { name: 'likes.md', text: 'Warm synth, quiet vocals, nothing that peaks. Long songs are welcome.' },
    { name: 'dislikes.md', text: 'No talk radio energy in the evening. No abrupt tempo jumps between tracks.' },
    { name: 'hours.md', text: 'Late night is for slow things. Mornings can carry more percussion.' },
    { name: 'notes.md', text: 'If I ask for focus, drop the vocals entirely and keep the volume steady.' },
  ],
  recent: [
    { ts: STARTED_AT, text: 'Prefers ambient over synthwave after 23:00.', evidence: { skipped: ['n1004'], after: '23:00' } },
    { ts: STARTED_AT, text: 'Replays The Long Way more than any other artist.', evidence: { replays: 6, artist: 'The Long Way' } },
  ],
};

const LYRIC = { lrc: '[00:00.00]Midnight Drive\n[00:12.00]the long way round\n[00:27.50]headlights on the water\n[00:44.00]we are in no hurry\n[01:02.00]let the hour keep us\n' };

// —— 可控状态。降级与错误都不在契约里，所以放在 /__mock/ 下，UI 完全不需要知道它们 ——
const state = {
  degraded: process.env.MOCK_DEGRADED === '1',
  error: process.env.MOCK_ERROR ?? null,
};

const ERRORS = {
  NO_LLM_KEY: { status: 503, retryable: false, message: 'No LLM key configured. Open Settings and add one.' },
  MUSIC_SOURCE_UNREACHABLE: { status: 502, retryable: true, message: 'The music source is unreachable.' },
  MUSIC_NOT_RESOLVABLE: { status: 422, retryable: false, message: 'This track cannot be resolved at any quality level.' },
  TTS_FAILED: { status: 502, retryable: true, message: 'Speech synthesis failed for this line.' },
  RATE_LIMITED: { status: 429, retryable: true, message: 'Rate limited by the upstream provider.' },
  INTERNAL: { status: 500, retryable: true, message: 'Internal error.' },
};

// apiKey 永远只进不出：这里存的是「配没配」，不是 key 本身。
const settings = {
  llm: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', protocol: 'openai', apiKeySet: false },
  tts: { provider: 'dashscope', voice: 'Cherry', apiKeySet: false },
};

const refs = (tracks) => tracks.map(ref);

// 喜欢列表（ADR-0010）。存 TrackRef 而不是 songId：v1 没有 songs 表。
let favorites = refs([byId('n1003')]);
const FAVORITE_ACTIONS = ['like', 'unlike'];

function nowPlaying() {
  return {
    track: state.degraded ? byId('l9001') : byId('n1001'),
    startedAt: STARTED_AT,
    djState: 'idle',
    onAir: true,
    degraded: state.degraded,
  };
}

// 降级时队列只保留能解析的（本地兜底两首）——抽象层第 6 节。
const currentQueue = () => (state.degraded ? refs(TRACKS.filter((t) => t.source === 'local')) : SHOW.play);

// —— HTTP 小工具 ——
const sendJson = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

// status 可以覆盖：未知路由要回 404，而错误码是封闭枚举（里面没有 NOT_FOUND 这种码）。
const sendError = (res, code, message, status) => {
  const e = ERRORS[code];
  sendJson(res, status ?? e.status, { error: { code, message: message ?? e.message, retryable: e.retryable } });
};

// 注入的错误只影响 JSON 端点：媒体路径豁免，否则一次 LLM 故障会把音乐也停掉（第 6 节的不变量）。
const rejectInjected = (res) => {
  if (!state.error) return false;
  sendError(res, state.error);
  return true;
};

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

// 内存里生成的静音 WAV：仓库里不放任何真实音频（需求·假设 3）。
let wav = null;
function silentWav() {
  if (wav) return wav;
  const sampleRate = 8000;
  const dataSize = sampleRate * 10 * 2; // 10 秒、单声道、16 bit
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  wav = buf; // 全是 0 = 静音
  return buf;
}

// 真 server 这里发缓存好的 mp3；mock 发内存静音 WAV，形状、Range、状态码一致就够了。
function sendAudio(req, res) {
  const buf = silentWav();
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': buf.length, 'accept-ranges': 'bytes' });
    return res.end(buf);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.writeHead(416, { 'content-range': `bytes */${buf.length}` });
    return res.end();
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), buf.length - 1) : buf.length - 1;
  if (start > end || start >= buf.length) {
    res.writeHead(416, { 'content-range': `bytes */${buf.length}` });
    return res.end();
  }
  const slice = buf.subarray(start, end + 1);
  res.writeHead(206, {
    'content-type': 'audio/wav',
    'content-length': slice.length,
    'accept-ranges': 'bytes',
    'content-range': `bytes ${start}-${end}/${buf.length}`,
  });
  res.end(slice);
}

// —— WS：手写握手与帧，因为要零依赖（抽象层 §7 说的是 Express，我们用内建 http 换来 0 依赖） ——
const sockets = new Set();

function encodeFrame(text) {
  const data = Buffer.from(text, 'utf8');
  const n = data.length;
  let head;
  if (n < 126) {
    head = Buffer.from([0x81, n]);
  } else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, data]);
}

const push = (socket, event) => socket.write(encodeFrame(JSON.stringify(event)));
const broadcast = (event) => { for (const socket of sockets) push(socket, event); };

// 口播逐句推：UI 的「逐句浮现」只有在 mock 上能跑出来，才不会等真后端才发现（需求·假设 2）。
function speak(lines) {
  // 只发给「这一轮开始时已在线的」客户端：否则上一轮的 setTimeout 会漏进之后才连上来的客户端，
  // 让它收到一段自己从没点过的口播。这个 bug 是契约测试抓出来的（见 PR 正文）。
  const targets = [...sockets];
  const send = (event) => { for (const socket of targets) push(socket, event); };
  send({ type: 'state', payload: { onAir: true, djState: 'thinking' } });
  lines.forEach((line, index) => {
    setTimeout(() => {
      send({ type: 'say', payload: { index, line } });
      if (index === lines.length - 1) {
        send({ type: 'state', payload: { onAir: true, djState: 'idle' } });
        send({ type: 'now', payload: nowPlaying() });
        send({ type: 'queue', payload: currentQueue() });
      }
    }, 120 * (index + 1));
  });
}

function attachSocket(req, socket) {
  const key = req.headers['sec-websocket-key'] ?? '';
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  sockets.add(socket);
  const drop = () => sockets.delete(socket);
  socket.on('close', drop);
  socket.on('error', drop);
  // 连上先给一份快照，UI 不必先轮询一轮。
  push(socket, { type: 'now', payload: nowPlaying() });
  push(socket, { type: 'queue', payload: currentQueue() });
  push(socket, { type: 'plan', payload: PLAN });
  push(socket, { type: 'state', payload: { onAir: true, djState: 'idle' } });
}

// —— 控制通道：不在契约里，UI 不需要知道它存在 ——
async function control(req, res) {
  if (req.method === 'GET') return sendJson(res, 200, { ...state });
  if (req.method !== 'POST') return sendJson(res, 405, { error: { code: 'INTERNAL', message: 'Use GET or POST.', retryable: false } });
  const body = await readJson(req);
  if ('degraded' in body) state.degraded = Boolean(body.degraded);
  if ('error' in body) {
    if (body.error !== null && !ERRORS[body.error]) {
      return sendJson(res, 400, { error: { code: 'INTERNAL', message: `Unknown error code: ${body.error}`, retryable: false } });
    }
    state.error = body.error ?? null;
  }
  // 状态变化要广播出去：UI 不改一行代码就能显示降级/错误态（验收标准第 3 条）。
  broadcast({ type: 'now', payload: nowPlaying() });
  if (state.error) broadcast({ type: 'error', payload: { code: state.error, ...ERRORS[state.error] } });
  return sendJson(res, 200, { ...state });
}

// —— 路由：路径与字段名严格照第 5 节的表 ——
async function handle(req, res) {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const method = req.method;

  if (path === '/__mock/control') return control(req, res);

  // 媒体路径：豁免注入的错误，也豁免鉴权（契约第 5 节）。
  if (method === 'GET' && (path.startsWith('/api/audio/') || path.startsWith('/tts/'))) return sendAudio(req, res);

  if (rejectInjected(res)) return;

  if (method === 'GET' && path === '/api/now') return sendJson(res, 200, nowPlaying());
  if (method === 'GET' && path === '/api/next') return sendJson(res, 200, currentQueue());
  if (method === 'GET' && path === '/api/taste') return sendJson(res, 200, TASTE);
  if (method === 'GET' && path === '/api/plan/today') return sendJson(res, 200, PLAN);
  if (method === 'POST' && path === '/api/plan/regenerate') {
    await readJson(req);
    return sendJson(res, 200, PLAN);
  }
  if (method === 'POST' && path === '/api/playback') {
    await readJson(req);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'GET' && path === '/api/favorites') return sendJson(res, 200, favorites);
  if (method === 'POST' && path === '/api/feedback') {
    const body = await readJson(req);
    if (!FAVORITE_ACTIONS.includes(body.action)) {
      // 错误码是封闭枚举，这里没有「参数不合法」这种码 —— 与未知路由同一个先例，用 INTERNAL。
      return sendError(res, 'INTERNAL', `action must be one of ${FAVORITE_ACTIONS.join('|')}, got ${JSON.stringify(body.action)}`, 400);
    }
    const track = byId(body.songId);
    if (!track) return sendError(res, 'INTERNAL', `Unknown songId: ${JSON.stringify(body.songId)}`, 400);
    // like / unlike 都幂等：先滤掉再决定加不加。
    const rest = favorites.filter((f) => f.id !== track.id);
    favorites = body.action === 'like' ? [...rest, ref(track)] : rest;
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'GET' && path === '/api/settings') return sendJson(res, 200, settings);
  if (method === 'PUT' && path === '/api/settings') {
    const body = await readJson(req);
    const next = { llm: { ...settings.llm }, tts: { ...settings.tts } };
    for (const key of ['baseUrl', 'model', 'protocol']) {
      if (body.llm?.[key] !== undefined) next.llm[key] = body.llm[key];
    }
    for (const key of ['provider', 'voice']) {
      if (body.tts?.[key] !== undefined) next.tts[key] = body.tts[key];
    }
    // key 只记「配没配」，值直接丢掉，绝不回显（危险字段禁令）。
    if (body.llm?.apiKey) next.llm.apiKeySet = true;
    if (body.tts?.apiKey) next.tts.apiKeySet = true;
    Object.assign(settings.llm, next.llm);
    Object.assign(settings.tts, next.tts);
    return sendJson(res, 200, settings);
  }
  if (method === 'POST' && path === '/api/chat') {
    await readJson(req);
    speak(SHOW.say);
    return sendJson(res, 200, SHOW);
  }
  if (method === 'GET' && path.startsWith('/api/lyric/')) {
    const id = path.slice('/api/lyric/'.length);
    return sendJson(res, 200, byId(id) ? LYRIC : null);
  }

  // 未知路径也走统一信封：错误码是封闭枚举，所以用 INTERNAL。
  return sendError(res, 'INTERNAL', `No mock route for ${method} ${path}`, 404);
}

export function createMockServer() {
  const server = createHttpServer(handle);
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/stream') return socket.destroy();
    return attachSocket(req, socket);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createMockServer().listen(PORT, '127.0.0.1', () => {
    console.log(`[mock] listening on http://127.0.0.1:${PORT}`);
    console.log(`[mock] control: curl -s http://127.0.0.1:${PORT}/__mock/control`);
  });
}