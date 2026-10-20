import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ErrorCode, StreamEvent } from '../shared/api-types.ts';
import { RadioFailure, type Radio } from './radio.ts';

/**
 * HTTP + WS 的翻译层（4.5 的 serving 部分）。**它不持有状态** —— 状态全在 core/radio.ts。
 *
 * 两条纪律：
 * - 只绑 127.0.0.1（ADR-0007：单端，只服务本机），并且要 `x-radio-token`
 *   （挡住浏览器里别的页面误打这个端口）。
 * - 媒体路径豁免鉴权与错误注入：`<audio>` 既不设自定义头，也不该被业务错误拦住（契约第 5 节）。
 */

export interface RadioServerOptions {
  radio: Radio;
  /** 与本机渲染进程共享的一次性令牌；空字符串 = 不校验（只该在开发里这么用）。 */
  token?: string;
  warn?: (message: string) => void;
}

/** 错误码 → HTTP 状态码 + 是否值得重试。与 mock 的 ERRORS 表同源。 */
const STATUS: Record<ErrorCode, { status: number; retryable: boolean }> = {
  NO_LLM_KEY: { status: 503, retryable: false },
  MUSIC_SOURCE_UNREACHABLE: { status: 502, retryable: true },
  MUSIC_NOT_RESOLVABLE: { status: 422, retryable: false },
  TTS_FAILED: { status: 502, retryable: true },
  RATE_LIMITED: { status: 429, retryable: true },
  INTERNAL: { status: 500, retryable: true },
};

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
};

const sendError = (res: ServerResponse, code: ErrorCode, message: string, status?: number): void => {
  const known = STATUS[code];
  sendJson(res, status ?? known.status, { error: { code, message, retryable: known.retryable } });
};

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const sameToken = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** 只发不收：这个 socket 是单向 server → client（契约）。 */
const encodeFrame = (text: string): Buffer => {
  const data = Buffer.from(text, 'utf8');
  const size = data.length;
  if (size < 126) return Buffer.concat([Buffer.from([0x81, size]), data]);
  if (size < 65536) {
    const head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(size, 2);
    return Buffer.concat([head, data]);
  }
  const head = Buffer.alloc(10);
  head[0] = 0x81;
  head[1] = 127;
  head.writeBigUInt64BE(BigInt(size), 2);
  return Buffer.concat([head, data]);
};

const TTS_PATH = /^\/tts\/([0-9a-f]{40})\.mp3$/;

function sendBytes(req: IncomingMessage, res: ServerResponse, audio: Uint8Array): void {
  const range = req.headers.range;
  if (range === undefined) {
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': audio.byteLength, 'accept-ranges': 'bytes' });
    res.end(Buffer.from(audio));
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match === null) {
    res.writeHead(416, { 'content-range': `bytes */${audio.byteLength}` });
    res.end();
    return;
  }
  const start = match[1] === '' ? 0 : Number(match[1]);
  const end = match[2] === '' ? audio.byteLength - 1 : Math.min(Number(match[2]), audio.byteLength - 1);
  if (start > end || start >= audio.byteLength) {
    res.writeHead(416, { 'content-range': `bytes */${audio.byteLength}` });
    res.end();
    return;
  }
  const slice = audio.subarray(start, end + 1);
  res.writeHead(206, {
    'content-type': 'audio/mpeg',
    'content-length': slice.byteLength,
    'accept-ranges': 'bytes',
    'content-range': `bytes ${start}-${end}/${audio.byteLength}`,
  });
  res.end(Buffer.from(slice));
}

export function createRadioServer(options: RadioServerOptions): Server {
  const radio = options.radio;
  const token = options.token ?? '';

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // —— 媒体：豁免鉴权（<audio> 设不了自定义头），也豁免业务错误 ——
      if (method === 'GET' && path.startsWith('/api/audio/')) {
        const songId = decodeURIComponent(path.slice('/api/audio/'.length));
        const level = url.searchParams.get('level');
        const target = await radio.resolveAudio(
          songId,
          level === 'lossless' || level === 'exhigh' || level === 'higher' || level === 'standard' ? level : undefined,
        );
        // 302 而不是自己转发：远端 CDN 认 Range、认分片，中间过一手只会把播放器搞坏。
        res.writeHead(302, { location: target });
        res.end();
        return;
      }
      if (method === 'GET' && path.startsWith('/tts/')) {
        const key = TTS_PATH.exec(path)?.[1];
        const audio = key === undefined ? null : radio.ttsAudio(key);
        if (audio === null) {
          sendError(res, 'INTERNAL', 'No cached speech at this path', 404);
          return;
        }
        sendBytes(req, res, audio);
        return;
      }

      // —— 其余全部要令牌 ——
      if (token !== '' && !sameToken(String(req.headers['x-radio-token'] ?? ''), token)) {
        sendError(res, 'INTERNAL', 'Missing or wrong x-radio-token', 401);
        return;
      }

      if (method === 'GET' && path === '/api/now') return sendJson(res, 200, radio.now());
      if (method === 'GET' && path === '/api/next') return sendJson(res, 200, radio.queue());
      if (method === 'GET' && path === '/api/taste') return sendJson(res, 200, await radio.taste());
      if (method === 'GET' && path === '/api/favorites') return sendJson(res, 200, await radio.favorites());

      if (method === 'GET' && path === '/api/stats') {
        const since = url.searchParams.get('since');
        return sendJson(res, 200, await radio.stats(since === null ? undefined : since));
      }
      if (method === 'GET' && path === '/api/history') {
        const raw = url.searchParams.get('limit');
        const limit = raw === null ? undefined : Number(raw);
        return sendJson(res, 200, await radio.history(limit === undefined || Number.isNaN(limit) ? undefined : limit));
      }
      if (method === 'GET' && path === '/api/plan/today') return sendJson(res, 200, await radio.planToday());
      if (method === 'POST' && path === '/api/plan/regenerate') {
        const body = await readJson(req);
        const reason = typeof body.reason === 'string' ? body.reason : undefined;
        return sendJson(res, 200, await radio.regeneratePlan(reason));
      }

      if (method === 'GET' && path === '/api/settings') return sendJson(res, 200, await radio.settings());
      if (method === 'PUT' && path === '/api/settings') {
        const body = await readJson(req);
        return sendJson(res, 200, await radio.saveSettings(body));
      }

      if (method === 'POST' && path === '/api/chat') {
        const body = await readJson(req);
        if (typeof body.text !== 'string') return sendError(res, 'INTERNAL', 'text must be a string', 400);
        return sendJson(res, 200, await radio.chat(body.text));
      }
      if (method === 'POST' && path === '/api/playback') {
        const body = await readJson(req);
        if (typeof body.songId !== 'string' || typeof body.event !== 'string' || typeof body.at !== 'string') {
          return sendError(res, 'INTERNAL', 'playback needs songId, event and at', 400);
        }
        if (body.event !== 'started' && body.event !== 'ended' && body.event !== 'skipped') {
          return sendError(res, 'INTERNAL', `event must be started|ended|skipped, got ${JSON.stringify(body.event)}`, 400);
        }
        await radio.playback({ songId: body.songId, event: body.event, at: body.at });
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'POST' && path === '/api/feedback') {
        const body = await readJson(req);
        if (typeof body.songId !== 'string' || typeof body.action !== 'string') {
          return sendError(res, 'INTERNAL', 'feedback needs songId and action', 400);
        }
        if (body.action !== 'like' && body.action !== 'unlike') {
          return sendError(res, 'INTERNAL', `action must be like|unlike, got ${JSON.stringify(body.action)}`, 400);
        }
        await radio.feedback(body.songId, body.action);
        return sendJson(res, 200, { ok: true });
      }

      // 未知路径也走统一信封：错误码是封闭枚举，所以用 INTERNAL。
      return sendError(res, 'INTERNAL', `No route for ${method} ${path}`, 404);
    } catch (cause: unknown) {
      if (cause instanceof RadioFailure) return sendError(res, cause.code, cause.message);
      options.warn?.(`server: ${cause instanceof Error ? cause.message : String(cause)}`);
      return sendError(res, 'INTERNAL', cause instanceof Error ? cause.message : String(cause));
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  server.on('upgrade', (req: IncomingMessage, socket: import('node:net').Socket) => {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/stream') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key'] ?? '') + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    const send = (event: StreamEvent): void => {
      if (socket.destroyed) return;
      socket.write(encodeFrame(JSON.stringify(event)));
    };
    const unsubscribe = radio.subscribe(send);
    const drop = (): void => unsubscribe();
    socket.on('close', drop);
    socket.on('error', drop);
  });

  return server;
}