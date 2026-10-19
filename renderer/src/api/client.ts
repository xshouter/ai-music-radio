// 与后端说话的唯一出口（铁律 5：前端只走 HTTP / WS）。
// base URL 与 token 只在这里注入一处 —— 切真后端只改这一个值（ADR-0006）。
import type {
  ApiError,
  ChatResponse,
  ErrorCode,
  FavoriteAction,
  FavoritesResponse,
  NextResponse,
  NowPlaying,
  OkResponse,
  PlanTodayResponse,
  PlaybackReport,
  SettingsInput,
  SettingsView,
  StreamEvent,
  TasteDoc,
} from '../../../shared/api-types.ts';

// dev 里留空：走 vite 的 dev proxy（mock 不发 CORS 头，跨源会被浏览器挡掉）。
// 真后端 / Electron 里由外部注入，例如 VITE_RADIO_BASE_URL=http://127.0.0.1:8799。
const BASE = import.meta.env.VITE_RADIO_BASE_URL ?? '';
const TOKEN = import.meta.env.VITE_RADIO_TOKEN ?? '';

/** 后端返回的统一错误信封（抽象层第 5 节）。UI 只认 code，不认 HTTP 状态码。 */
export class ApiFailure extends Error {
  readonly code: ErrorCode | string;
  readonly retryable: boolean;

  constructor(code: ErrorCode | string, message: string, retryable: boolean) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init?.body) headers['content-type'] = 'application/json';
  if (TOKEN) headers['x-radio-token'] = TOKEN;

  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // 媒体端点不是 JSON，不该在这里出现
    }
  }
  if (!res.ok) {
    const envelope = (body as ApiError | null)?.error;
    throw new ApiFailure(
      envelope?.code ?? 'INTERNAL',
      envelope?.message ?? `HTTP ${res.status}`,
      envelope?.retryable ?? true,
    );
  }
  return body as T;
}

export const getNow = () => request<NowPlaying>('/api/now');
export const getNext = () => request<NextResponse>('/api/next');
export const getTaste = () => request<TasteDoc>('/api/taste');
export const getPlanToday = () => request<PlanTodayResponse>('/api/plan/today');
export const getSettings = () => request<SettingsView>('/api/settings');

/** PUT /api/settings。省略的字段不改；apiKey / cookie 留空等于「不改」（ADR-0005 / ADR-0011）。 */
export const putSettings = (input: SettingsInput) =>
  request<SettingsView>('/api/settings', { method: 'PUT', body: JSON.stringify(input) });

export const chat = (text: string) =>
  request<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });

export const regeneratePlan = (reason?: string) =>
  request<PlanTodayResponse>('/api/plan/regenerate', { method: 'POST', body: JSON.stringify({ reason }) });

export const reportPlayback = (report: PlaybackReport) =>
  request<OkResponse>('/api/playback', { method: 'POST', body: JSON.stringify(report) });

export const getFavorites = () => request<FavoritesResponse>('/api/favorites');

/** POST /api/feedback：口味意图（喜欢 / 取消喜欢）。幂等，和「播放事实」是两条线（ADR-0010）。 */
export const reportFeedback = (songId: string, action: FavoriteAction) =>
  request<OkResponse>('/api/feedback', { method: 'POST', body: JSON.stringify({ songId, action }) });

/** 音频走 Range 透传，交给 <audio> 自己去取，不走 request()。 */
export const audioUrl = (songId: string) => `${BASE}/api/audio/${encodeURIComponent(songId)}`;

/**
 * 订阅 WS /stream。契约里它是单向 server → client。
 * shortcut: WS 带不了 token（浏览器不给 WS 设自定义头），v1 靠「只监听 127.0.0.1」兜底；
 * 要升级时改成先 HTTP 换一次性 ticket、再拿 ticket 连 WS。
 */
export function openStream(onEvent: (event: StreamEvent) => void, onStatus: (up: boolean) => void): () => void {
  const origin = BASE || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/stream`);
  let closed = false;

  socket.onopen = () => onStatus(true);
  socket.onclose = () => {
    if (!closed) onStatus(false);
  };
  socket.onmessage = (message) => {
    try {
      onEvent(JSON.parse(String(message.data)) as StreamEvent);
    } catch {
      // 坏帧丢掉就行：WS 只是推送通道，HTTP 端点是真相
    }
  };

  return () => {
    closed = true;
    socket.close();
  };
}