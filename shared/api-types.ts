// 第 5 节 API 契约：前后端**唯一真相**（ADR-0006：不版本化，靠契约测试保证一致）。
// 这里只有类型；mock/ 与将来的 core/server.ts 必须返回同样的路径与同样的字段名。
// 改这份文件 = 开 ADR 的级别（铁律 3）。
import type { DayPlan, DjState, Lyric, Show, TasteUpdate, Track, TrackRef } from './domain.ts';

/** GET /api/now。degraded 让 UI 能在 ON AIR 旁显示 DEGRADED 徽标（抽象层第 6 节）。 */
export interface NowPlaying {
  track: Track | null;
  startedAt: string | null;
  djState: DjState;
  onAir: boolean;
  degraded: boolean;
}

/** GET /api/taste：人写的语料（只读）+ 系统学到的结构化更新（ADR-0004）。 */
export interface TasteDoc {
  corpus: { name: string; text: string }[];
  recent: TasteUpdate[];
}

/** GET /api/settings：出参与入参分离 —— key 只回显「是否已配置」，绝不回显明文（ADR-0005）。 */
export interface SettingsView {
  llm: { baseUrl: string; model: string; protocol: 'openai' | 'anthropic'; apiKeySet: boolean };
  tts: { provider: string; voice: string; apiKeySet: boolean };
}

/** PUT /api/settings。封闭 key，写入时显式校验（ADR-0005）。 */
export interface SettingsInput {
  llm?: { baseUrl?: string; model?: string; protocol?: 'openai' | 'anthropic'; apiKey?: string };
  tts?: { provider?: string; voice?: string; apiKey?: string };
}

/** 封闭的错误码枚举（抽象层第 5 节）。 */
export type ErrorCode =
  | 'NO_LLM_KEY'
  | 'MUSIC_SOURCE_UNREACHABLE'
  | 'MUSIC_NOT_RESOLVABLE'
  | 'TTS_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** 所有错误统一用这个信封，HTTP 状态码照常用。 */
export interface ApiError {
  error: { code: ErrorCode; message: string; retryable: boolean };
}

/** 请求体 */
export interface ChatRequest {
  text: string;
}
export interface PlanRegenerateRequest {
  reason?: string;
}
export interface PlaybackReport {
  songId: string;
  event: 'started' | 'ended' | 'skipped';
  at: string;
}
export interface OkResponse {
  ok: true;
}

/** WS /stream：单向 server → client。say 逐句推，UI 逐句浮现。 */
export type StreamEvent =
  | { type: 'now'; payload: NowPlaying }
  | { type: 'say'; payload: { index: number; line: string } }
  | { type: 'queue'; payload: TrackRef[] }
  | { type: 'plan'; payload: DayPlan }
  | { type: 'state'; payload: { onAir: boolean; djState: DjState } }
  | { type: 'error'; payload: { code: string; message: string; retryable: boolean } };

/** 供将来 UI 的 client.ts 与真 server 直接引用的响应别名。 */
export type ChatResponse = Show;
export type NextResponse = TrackRef[];
export type LyricResponse = Lyric | null;
export type PlanTodayResponse = DayPlan | null;