// 领域类型：系统的「名词」层。纯类型，零运行时依赖（铁律 5 / 抽象层第 2 节）。
// 约定：所有时间戳是 ISO 8601 字符串而不是 Date —— 它要跨 HTTP 边界、要落库（抽象层第 4 节）。

/** 音质档位。降级时逐档往下试：lossless → exhigh → higher → standard（抽象层第 6 节）。 */
export type QualityLevel = 'lossless' | 'exhigh' | 'higher' | 'standard';

/** DJ 的状态机。 */
export type DjState = 'idle' | 'thinking' | 'speaking';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  coverUrl?: string;
  source: string;
}

/** 队列里只带必要信息。 */
export interface TrackRef {
  id: string;
  title: string;
  artist: string;
}

/** 取到的可播放地址。level 是**实际**档位，可能低于请求的档位（降级的结果）。 */
export interface ResolvedAudio {
  url: string;
  level: QualityLevel;
  expiresAt?: number;
}

/**
 * 一次推理的产物：一段完整的电台时段（ADR-0001）。
 * say 逐句（不是一整段：要一句一句浮现、一句一句合成）；play 一次给一批 3–6 首。
 */
export interface Show {
  say: string[];
  play: TrackRef[];
  reason: string;
  segue: string | null;
}

export interface DjMessage {
  id: string;
  ts: string;
  role: 'dj' | 'me' | 'system';
  text: string;
  meta?: Record<string, unknown>;
}

export interface PlanBlock {
  start: string;
  end: string;
  mood: string;
  genres: string[];
  tracks: TrackRef[];
}

export interface DayPlan {
  date: string;
  createdAt: string;
  blocks: PlanBlock[];
  active: boolean;
}

/** 一首歌的播放事实（不是预测）：含实际音质档位与是否被跳过。统计与 taste 闭环都靠它。 */
export interface PlayEvent {
  ts: string;
  songId: string;
  title: string;
  artist: string;
  source: string;
  level: QualityLevel;
  startedAt: string;
  endedAt: string | null;
  skipped: boolean;
  reason: string | null;
}

export interface PlayStats {
  played: number;
  skipped: number;
  replays: number;
  topArtists: { artist: string; count: number }[];
}

/** 系统学到的一条口味更新（ADR-0004：结构化，不回写人写的语料）。 */
export interface TasteUpdate {
  ts: string;
  text: string;
  evidence: Record<string, unknown>;
}

export interface Weather {
  tempC: number;
  text: string;
}

export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
}