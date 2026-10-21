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
//   POST /__mock/control  {"boot":true}           # 放一遍假的开机进度（调进度界面用）
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

// 口播 = 对当前这首歌的简短分析（需求：口播内容是一段简短的歌曲分析）。
// 词级时间戳与音频长度同源：mock 的静音 WAV 就按词时间戳的长度生成（ADR-0012）。
const TTS_SECONDS = new Map();
function speech(index, line) {
  let at = 0;
  const words = line.split(' ').map((text) => {
    const startMs = at;
    const bare = text.replace(/[^A-Za-z0-9']/g, '').length || 3;
    at += Math.round(300 * Math.max(0.6, Math.min(2.4, bare / 5)));
    return { text, startMs, endMs: at };
  });
  const hash = createHash('sha1').update(line).digest('hex').slice(0, 12);
  TTS_SECONDS.set(hash, at / 1000);
  return { kind: 'intro', index, line, audioUrl: `/tts/${hash}.mp3`, words };
}

const analysis = (track) => [
  `${track.title} — ${track.artist}. Slow synth, and nothing above a walking pace.`,
  'Warm pads, a drum machine that never rushes, and four minutes of room to think in.',
  'Neon Hours next: same family, a shade brighter.',
];

const show = () => ({
  say: analysis(nowPlaying().track),
  play: ['n1001', 'n1002', 'n1003'].map((id) => ref(byId(id))),
  reason: 'Evening slot and low energy: warm synth, nothing above 120 BPM, no vocals that fight the room tone.',
  segue: 'Stay with me. We are drifting into the night from here.',
});

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
  // tts.provider 的出厂值是 piper（ADR-0022）；voice 留空 = 用音色库默认音色。
  tts: { provider: 'piper', voice: '', apiKeySet: false },
  // 第三块（ADR-0011）：cookie 的值一次都不存进内存，只存「配没配」。
  music: { provider: 'netease', cookieSet: false },
};

// POST /api/models 的假目录：mock 不联网，能给的就是形状。
const MOCK_MODELS = ['qwen-plus', 'qwen3.7-max', 'deepseek-v4.1-flash', 'glm-5.2'];

const refs = (tracks) => tracks.map(ref);

// 喜欢列表（ADR-0010）。存 TrackRef 而不是 songId：v1 没有 songs 表。
let favorites = refs([byId('n1003'), byId('n1006'), byId('n1008')]);
const FAVORITE_ACTIONS = ['like', 'unlike'];

// —— ADR-0013：Profile 要的两本账。此前 POST /api/playback 是空实现（没有任何出口读它），
// 现在统计要读，所以 mock 必须真的记账 —— 否则 Profile 上的数字永远是 0，那一版界面等于没验。
let messageSeq = 0;
const nextId = () => `m${++messageSeq}`;
const messages = [
  { id: nextId(), ts: STARTED_AT, role: 'system', text: 'Station up. Playing from taste.md.' },
  { id: nextId(), ts: STARTED_AT, role: 'dj', text: 'Evening. Warm synth, nothing fast.' },
  { id: nextId(), ts: STARTED_AT, role: 'me', text: 'something quiet' },
  { id: nextId(), ts: STARTED_AT, role: 'dj', text: 'Staying low. No vocals that fight the room tone.' },
];

// 一条播放记录 = 一次 started；同一首再 started 算一次重播；ended / skipped 收尾同一条。
const plays = [];
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
function seedPlay(id, n, patch = {}) {
  const t = byId(id);
  plays.push({ ts: minutesAgo(n), songId: t.id, title: t.title, artist: t.artist, source: t.source, level: 'exhigh', startedAt: minutesAgo(n), endedAt: null, skipped: false, reason: null, replay: false, ...patch });
}
// 开局就有账可看：一次跳过、一次重播（都由同一套统计读出来，不是写死的数字）。
seedPlay('n1003', 52, { endedAt: minutesAgo(48) });
seedPlay('n1004', 44, { endedAt: minutesAgo(43), skipped: true });
seedPlay('n1001', 30, { endedAt: minutesAgo(26) });
seedPlay('n1006', 22, { endedAt: minutesAgo(19) });
seedPlay('n1001', 12, { replay: true });

function recordPlay(body) {
  const track = byId(body.songId);
  if (!track) return;
  const at = typeof body.at === 'string' ? body.at : new Date().toISOString();
  if (body.event === 'started') {
    plays.push({ ts: at, songId: track.id, title: track.title, artist: track.artist, source: track.source, level: 'exhigh', startedAt: at, endedAt: null, skipped: false, reason: null, replay: plays.some((p) => p.songId === track.id) });
    return;
  }
  const open = [...plays].reverse().find((p) => p.songId === track.id && p.endedAt === null);
  if (!open) return;
  open.endedAt = at;
  if (body.event === 'skipped') open.skipped = true;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

function stats(sinceRaw) {
  const parsed = sinceRaw ? Date.parse(sinceRaw) : NaN;
  const from = Number.isNaN(parsed) ? startOfToday() : new Date(parsed);
  const inWindow = plays.filter((p) => new Date(p.ts) >= from);
  const byArtist = new Map();
  for (const p of inWindow) byArtist.set(p.artist, (byArtist.get(p.artist) ?? 0) + 1);
  return {
    played: inWindow.length,
    skipped: inWindow.filter((p) => p.skipped).length,
    replays: inWindow.filter((p) => p.replay).length,
    topArtists: [...byArtist].map(([artist, count]) => ({ artist, count })).sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist)).slice(0, 5),
  };
}

// 越界夹住、非法回默认：错误码是封闭枚举，里面没有「参数不合法」这种码（ADR-0013）。
function historyPage(limitRaw) {
  const n = limitRaw === null || limitRaw === '' ? NaN : Number(limitRaw);
  const limit = Number.isFinite(n) ? Math.max(1, Math.min(200, Math.trunc(n))) : 50;
  return messages.slice().reverse().slice(0, limit);
}

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
const currentQueue = () => (state.degraded ? refs(TRACKS.filter((t) => t.source === 'local')) : show().play);

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
function silentWav(seconds) {
  const sampleRate = 8000;
  const dataSize = Math.round(sampleRate * seconds) * 2; // 单声道、16 bit
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
  return buf; // 全是 0 = 静音
}

// 真 server 这里发缓存好的 mp3；mock 发内存静音 WAV，形状、Range、状态码一致就够了。
function sendAudio(req, res, path) {
  const hash = /^\/tts\/([0-9a-f]+)\.mp3$/.exec(path)?.[1];
  const buf = silentWav(hash ? (TTS_SECONDS.get(hash) ?? 10) : 10);
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

// 假的开机进度（ADR-0032）。steps 每次都给**累积**的那一份 —— 契约就是这么定的，
// 于是「晚连上的客户端补一条就对齐」在 mock 上也是真的。
const BOOT_STEPS = ['daily-pool', 'recent-plays', 'draft-plan', 'opening-line'];

function playBoot() {
  BOOT_STEPS.forEach((_, index) => {
    setTimeout(() => {
      broadcast({ type: 'progress', payload: { phase: 'running', steps: BOOT_STEPS.slice(0, index + 1) } });
    }, 1500 * (index + 1));
  });
  setTimeout(
    () => broadcast({ type: 'progress', payload: { phase: 'done', steps: BOOT_STEPS } }),
    1500 * (BOOT_STEPS.length + 1),
  );
}

// 口播逐句推：UI 的「逐句浮现」只有在 mock 上能跑出来，才不会等真后端才发现（需求·假设 2）。
function speak(lines, only) {
  // 只发给「这一轮开始时已在线的」客户端：否则上一轮的 setTimeout 会漏进之后才连上来的客户端，
  // 让它收到一段自己从没点过的口播。这个 bug 是契约测试抓出来的（见 PR 正文）。
  const targets = only ? [only] : [...sockets];
  const send = (event) => { for (const socket of targets) push(socket, event); };
  send({ type: 'state', payload: { onAir: true, djState: 'thinking' } });
  lines.forEach((line, index) => {
    setTimeout(() => {
      send({ type: 'say', payload: speech(index, line) });
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
  // 一开机我就打碟：电台一上线，DJ 先对当前这首歌说三句。
  speak(show().say, socket);
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
  // {"wipe":true} 清空两本账（ADR-0013），用来**真的**验一遍 Profile 的空态。
  // 它不在契约里，UI 永远不会调它（和 degraded / error 同一个规矩）。
  if (body.wipe) {
    messages.length = 0;
    plays.length = 0;
    TASTE.corpus.length = 0;
    TASTE.recent.length = 0;
    PLAN.blocks.length = 0;
  }
  if (body.boot) playBoot();
  // 状态变化要广播出去：UI 不改一行代码就能显示降级/错误态（验收标准第 3 条）。
  broadcast({ type: 'now', payload: nowPlaying() });
  if (state.error) broadcast({ type: 'error', payload: { code: state.error, ...ERRORS[state.error] } });
  return sendJson(res, 200, { ...state });
}

// —— 路由：路径与字段名严格照第 5 节的表 ——
async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method;

  if (path === '/__mock/control') return control(req, res);

  // 媒体路径：豁免注入的错误，也豁免鉴权（契约第 5 节）。
  if (method === 'GET' && (path.startsWith('/api/audio/') || path.startsWith('/tts/'))) return sendAudio(req, res, path);

  if (rejectInjected(res)) return;

  if (method === 'GET' && path === '/api/now') return sendJson(res, 200, nowPlaying());
  if (method === 'GET' && path === '/api/next') return sendJson(res, 200, currentQueue());
  if (method === 'GET' && path === '/api/taste') return sendJson(res, 200, TASTE);
  // ADR-0013 的两个只读端点：省略 since = 今天 00:00；limit 越界夹住。
  if (method === 'GET' && path === '/api/stats') return sendJson(res, 200, stats(url.searchParams.get('since')));
  if (method === 'GET' && path === '/api/history') return sendJson(res, 200, historyPage(url.searchParams.get('limit')));
  if (method === 'GET' && path === '/api/plan/today') return sendJson(res, 200, PLAN);
  if (method === 'POST' && path === '/api/plan/regenerate') {
    await readJson(req);
    return sendJson(res, 200, PLAN);
  }
  if (method === 'POST' && path === '/api/playback') {
    recordPlay(await readJson(req));
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
  // 模型列表：替身不联网，给一份固定的目录（形状对了，下拉框就走得通）。
  if (method === 'POST' && path === '/api/models') {
    const body = await readJson(req);
    if (typeof body.baseUrl !== 'string' || body.baseUrl === '') {
      return sendError(res, 'INTERNAL', 'models needs a baseUrl', 400);
    }
    return sendJson(res, 200, { models: MOCK_MODELS });
  }
  if (method === 'GET' && path === '/api/settings') return sendJson(res, 200, settings);
  if (method === 'PUT' && path === '/api/settings') {
    const body = await readJson(req);
    const next = { llm: { ...settings.llm }, tts: { ...settings.tts }, music: { ...settings.music } };
    for (const key of ['baseUrl', 'model']) {
      if (body.llm?.[key] !== undefined) next.llm[key] = body.llm[key];
    }
    // protocol 是封闭枚举：非法值直接忽略，不写进去（契约：写入时显式校验）。
    if (['openai', 'anthropic'].includes(body.llm?.protocol)) next.llm.protocol = body.llm.protocol;
    for (const key of ['provider', 'voice']) {
      if (body.tts?.[key] !== undefined) next.tts[key] = body.tts[key];
    }
    if (body.music?.provider !== undefined) next.music.provider = body.music.provider;
    // key 只记「配没配」，值直接丢掉，绝不回显（危险字段禁令）。
    if (body.llm?.apiKey) next.llm.apiKeySet = true;
    if (body.tts?.apiKey) next.tts.apiKeySet = true;
    // cookie 的值直接丢掉，一个字节都不留（危险字段禁令 / ADR-0011）。
    if (body.music?.cookie) next.music.cookieSet = true;
    Object.assign(settings.llm, next.llm);
    Object.assign(settings.tts, next.tts);
    Object.assign(settings.music, next.music);
    return sendJson(res, 200, settings);
  }
  if (method === 'POST' && path === '/api/chat') {
    const body = await readJson(req);
    if (typeof body.text === 'string' && body.text.trim()) {
      messages.push({ id: nextId(), ts: new Date().toISOString(), role: 'me', text: body.text.trim() });
    }
    const result = show();
    // 对听众的答话不是口播（用户定）：整段一条 dj 消息 + 一条 kind:'talk'。talk 没有音频、没有词表，
    // 于是 UI 不给它入口、也不进全屏口播。历史照记（ADR-0013）。
    const reply = result.say.join(' ');
    messages.push({ id: nextId(), ts: new Date().toISOString(), role: 'dj', text: reply });
    broadcast({ type: 'say', payload: { kind: 'talk', index: 0, line: reply, audioUrl: '', words: [] } });
    broadcast({ type: 'state', payload: { onAir: true, djState: 'idle' } });
    broadcast({ type: 'now', payload: nowPlaying() });
    broadcast({ type: 'queue', payload: currentQueue() });
    return sendJson(res, 200, result);
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