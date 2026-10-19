// 抽象层第 3 节：端口（Ports）。
//
// 这里只有类型，零运行时依赖 —— 端口声明的是「内核依赖什么」，实现住在 core/providers/。
// 与 shared/api-types.ts 的分工：api-types 是**跨进程**的契约（HTTP/WS），
// 这里只是**进程内**的依赖面。两者都不许 import renderer/ 或 node:*（CI 的 check-boundaries 挡住）。

import type {
  CalendarEvent,
  DayPlan,
  DjMessage,
  PlayEvent,
  PlayStats,
  QualityLevel,
  ResolvedAudio,
  Show,
  TasteUpdate,
  Track,
  TrackRef,
  Weather,
} from './domain.ts';
import type { TasteDoc } from './api-types.ts';

/**
 * 取消语义。
 *
 * 第 3 节原文写的是 AbortSignal，但 shared/tsconfig.json 是 lib: ES2022 + types: []，
 * 那里**没有** AbortSignal —— 说明那份文档从没被编译过。
 * 不引 DOM lib 来补：shared/ 同时被 renderer 与 core 消费，开 DOM 就等于让这一层随手能写 document。
 * 用结构化类型代替：原生 AbortSignal 满足这个形状，直接传即可。
 */
export interface CancelSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

/** JSON Schema 的最小可用子集：够描述工具参数就行，需要更多关键字时再扩。 */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

// ── 3.1 LlmProvider —— 任何兼容 key 都能用 ────────────────────────────────

export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** role='tool' 时必填。 */
  toolCallId?: string;
  /** role='assistant' 时可能有。 */
  toolCalls?: LlmToolCall[];
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  toolChoice?: 'auto' | 'required' | { name: string };
  temperature?: number;
  maxTokens?: number;
  signal?: CancelSignal;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * provider **只负责一次补全**，不负责工具循环。
 * openai 的 tools/tool_calls 与 anthropic 的 tool_use/tool_result 差异全部在两个适配器里抹平，
 * 3.7 的 Brain 只看到统一的 LlmResponse —— 加第三个厂商＝加一个文件，不动大脑。
 */
export interface LlmProvider {
  readonly id: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ── 3.2 TtsProvider ──────────────────────────────────────────────────────

export interface TtsRequest {
  text: string;
  voice: string;
  format: 'mp3';
  speed?: number;
  signal?: CancelSignal;
}

export interface TtsResult {
  audio: Uint8Array;
  contentType: string;
}

/** 缓存不在 provider 里，在 core/tts.ts：键含 providerId，换 provider 不污染旧缓存。 */
export interface TtsProvider {
  readonly id: string;
  synthesize(req: TtsRequest): Promise<TtsResult>;
}

// ── 3.3 MusicSource —— 降级链 ─────────────────────────────────────────────

export interface MusicSeed {
  songId?: string;
  genres?: string[];
  mood?: string;
}

/**
 * 单个音乐源。降级链（音质逐档下试、源逐个换、全空则 degraded）是
 * MusicSourceChain 的职责，不是调用方的职责 —— 调用方只会拿到 ResolvedAudio 或 null。
 */
export interface MusicSource {
  readonly id: string;
  recommend(seed: MusicSeed, limit: number): Promise<Track[]>;
  search(keywords: string, limit: number): Promise<Track[]>;
  resolve(songId: string, level: QualityLevel): Promise<ResolvedAudio | null>;
  // v1 不做歌词（ADR-0009），所以这里没有 lyric()。第 3.3 节原本有 —— 端口是最终形态，不留一个已知要删的方法。
  // 债已还清：契约 / mock / 测试 / renderer 里的歌词面都已删除（PR #15），端口这边没有尾巴要跟。
}

// ── 3.5 Store —— 前端永远拿不到它 ────────────────────────────────────────

/** server 侧端口。永远不出现在渲染进程：前端拿到的是 api-types 里的 JSON。 */
export interface Store {
  appendMessage(m: DjMessage): Promise<void>;
  recentMessages(limit: number): Promise<DjMessage[]>;
  recordPlay(p: PlayEvent): Promise<void>;
  recentPlays(limit: number): Promise<PlayEvent[]>;
  playStats(since: Date): Promise<PlayStats>;
  savePlan(p: DayPlan): Promise<void>;
  activePlan(date: string): Promise<DayPlan | null>;
  /**
   * 喜欢列表（ADR-0010）。存 TrackRef 而不是 songId：v1 没有 songs 表，
   * 而喜欢列表这个 UI 需要曲名与歌手。
   */
  favorites(): Promise<TrackRef[]>;
  setFavorite(track: TrackRef, liked: boolean): Promise<void>;
  getPref<T>(key: string): Promise<T | null>;
  setPref<T>(key: string, value: T): Promise<void>;
  appendTasteUpdate(u: TasteUpdate): Promise<void>;
  recentTasteUpdates(limit: number): Promise<TasteUpdate[]>;
}

// ── 3.6 Clock / EnvProvider / TasteRepo ──────────────────────────────────

/** 为了让调度器可测：禁止在 core/ 里直接 new Date()。 */
export interface Clock {
  now(): Date;
}

export interface EnvProvider {
  weather(at: Date): Promise<Weather | null>;
  /** v1 恒返回 []（没有日历接入）。 */
  calendar(day: string): Promise<CalendarEvent[]>;
}

export interface TasteRepo {
  read(): Promise<TasteDoc>;
  appendLearned(line: string, evidence: TasteUpdate): Promise<void>;
}

// ── 3.7 Brain ────────────────────────────────────────────────────────────

export interface BrainInput {
  trigger: 'schedule' | 'chat' | 'track_end' | 'manual';
  userText?: string;
  now: Date;
}

export interface Brain {
  think(input: BrainInput): Promise<Show>;
}