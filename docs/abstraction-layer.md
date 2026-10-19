# 抽象层设计（Abstraction Layer Design）

> 状态：**已冻结** v1.1 ｜ 2026-10-20 ｜ ADR-0001…0007 ｜ 其中 ADR-0007 是一次**范围修正**（v1 只做 PC 单端）
> 这份文档定义系统的「缝」（seam）。它必须先于实现冻结——因为前端要对着它写（铁律 3），测试要对着它写（第 8 节），provider 要按它替换（第 3 节）。

---

## 1. 为什么需要这一层

三条约束逼出了这套抽象，不是为了抽象而抽象：

1. **前端永远不碰数据库**（铁律 5）→ 前后端之间只能存在**一个**契约，且这个契约必须是纯数据（无 class、无 db handle、无 node 内建）。
2. **先前端再后端**（铁律 3）→ 契约必须先于实现存在，且必须能被 mock 到「界面可以完整跑起来」的程度。
3. **外部能力一定会换**（LLM / TTS / 音乐源 / 输出设备）→ 每种外部能力一个端口（Port），实现按依赖倒置在唯一组装点注入。

**判据**：如果某个模块换掉实现时不需要动第二处代码，这个缝就切对了。

---

## 2. 分层与依赖方向

```
renderer/  ──HTTP + WS──▶  main/（Electron 外壳：组装 + 开窗 + 托盘）
                                    │  唯一允许 new 具体实现的地方
                                    ▼
                              core/  ──端口接口──▶  core/providers/*（实现）
                                    │
                                    ▼
                              shared/（只有类型声明，零运行时依赖）
```

### 依赖规则（CI 强制检查，违规即红）

| 层 | 可以依赖 | 严禁依赖 |
|---|---|---|
| `shared/` | 无 | 任何东西（纯类型） |
| `renderer/` | `shared/` 的 API 类型 | `core/**`、`main/**`、`electron`、`better-sqlite3`、`node:fs`、`node:path` |
| `core/**` | `shared/`、本目录下的端口接口 | `electron`、`renderer/**`、任何**具体** provider 实现 |
| `core/providers/**` | `core/` 的端口接口、`shared/` | `core/brain`、`core/scheduler`、`core/router` 等上层编排 |
| `main/` | `core/**`、`renderer/` 的构建产物 | — |

**唯一组装点**：`main/bootstrap.ts`。`core/` 里出现 `new NeteaseSource()` 这类代码即为设计错误。

**目录形状**

```
shared/            domain.ts  api-types.ts  ports.ts        # 只有类型
core/
  router.ts  context.ts  brain/  scheduler.ts  tts.ts  taste.ts
  music/   index.ts (链)  netease.ts  local.ts
  state/   sqlite-store.ts  migrations/
  server.ts                                                # HTTP + WS，实现第 5 节契约
  providers/ llm-openai.ts  llm-anthropic.ts  tts-dashscope.ts  tts-openai.ts
main/     bootstrap.ts  window.ts  tray.ts
renderer/ views/player views/profile views/settings  api/client.ts
```

---

## 3. 端口（Ports）

所有端口定义在 `shared/ports.ts`，只有类型。实现住在 `core/providers/`。

**已落地**：端口现在真的在 [`shared/ports.ts`](../shared/ports.ts) 里（此前只有文档）。
落地时发现原文有一处编译不过：第 3.1 节写的是 `AbortSignal`，但 `shared/tsconfig.json` 是
`lib: ES2022` + `types: []`——那里**没有** `AbortSignal`。文档没被编译过，所以一直没暴露。
没有引 DOM lib 来补（`shared/` 同时被 `renderer/` 与 `core/` 消费，开 DOM 就等于让这一层能随手写 `document`），
改成结构化类型 `CancelSignal`：原生 `AbortSignal` 满足它的形状，直接传即可。

### 3.1 LlmProvider —— 任何兼容 key 都能用

```ts
export interface LlmToolSpec { name: string; description: string; parameters: JsonSchema }
export interface LlmToolCall { id: string; name: string; args: unknown }
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;          // role='tool' 时必填
  toolCalls?: LlmToolCall[];    // role='assistant' 时可能有
}
export interface LlmRequest {
  model: string; messages: LlmMessage[]; tools?: LlmToolSpec[];
  toolChoice?: 'auto' | 'required' | { name: string };
  temperature?: number; maxTokens?: number; signal?: AbortSignal;
}
export interface LlmResponse {
  text: string; toolCalls: LlmToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { inputTokens: number; outputTokens: number };
}
export interface LlmProvider { readonly id: string; complete(req: LlmRequest): Promise<LlmResponse> }
```

**设计要点**：provider **只负责一次补全**，不负责工具循环。`openai` 的 `tools/tool_calls` 与 `anthropic` 的 `tool_use/tool_result` 差异全部在 `llm-openai.ts` / `llm-anthropic.ts` 里抹平，`core/brain/` 只看到统一的 `LlmResponse`。这样加第三个厂商＝加一个文件，不动大脑。

### 3.2 TtsProvider

```ts
export interface TtsProvider {
  readonly id: string;
  synthesize(req: {
    text: string; voice: string; format: 'mp3'; speed?: number; signal?: AbortSignal;
  }): Promise<{ audio: Uint8Array; contentType: string }>;
}
```

缓存不在 provider 里，在 `core/tts.ts`：键 `sha1(text + voice + providerId)`，落 `cache/tts/<hash>.mp3`，命中直接返回文件。**换 provider 不污染旧缓存。**

### 3.3 MusicSource —— 降级链

```ts
export type QualityLevel = 'lossless' | 'exhigh' | 'higher' | 'standard';
export interface MusicSource {
  readonly id: string;
  recommend(seed: { songId?: string; genres?: string[]; mood?: string }, limit: number): Promise<Track[]>;
  search(keywords: string, limit: number): Promise<Track[]>;
  resolve(songId: string, level: QualityLevel): Promise<ResolvedAudio | null>;
}
export interface ResolvedAudio { url: string; level: QualityLevel; expiresAt?: number }
```

`core/music/index.ts` 实现 `MusicSourceChain implements MusicSource`，按顺序试；任一源返回 `null` 就下一个；全失败返回 `null`。**降级是链的职责，不是调用方的职责。**

> `lyric()` 已去掉：v1 不做歌词（[ADR-0009](adr/0009-drop-lyric.md)）。
> mock / renderer 里歌词面的清理由「UI 重做」那个 PR 一并完成。

### 3.4 ~~OutputTarget~~（已在 v1.1 删除）

v0.1 曾定义 `OutputTarget` 端口（`local` / `lan` / `upnp`），理由是"声音可以往不同地方出"。
核对真实需求后：**v1 只做 PC 单端**，既没有第二个客户端，也没有第二个真实播放目标——
一个实现撑不起一个端口，这恰好踩在第 9 节反例清单的第一条上。

**端口已删除。** PC 端由渲染进程直接播放 `<audio src="/api/audio/:songId">`。
理由、代价与重新打开的条件见 [ADR-0007](adr/0007-pc-only-single-output.md)。

### 3.5 Store —— 前端永远拿不到它

```ts
export interface Store {
  appendMessage(m: DjMessage): Promise<void>;
  recentMessages(limit: number): Promise<DjMessage[]>;
  recordPlay(p: PlayEvent): Promise<void>;
  recentPlays(limit: number): Promise<PlayEvent[]>;
  playStats(since: Date): Promise<PlayStats>;
  savePlan(p: DayPlan): Promise<void>;
  activePlan(date: string): Promise<DayPlan | null>;
  getPref<T>(key: string): Promise<T | null>;
  setPref<T>(key: string, value: T): Promise<void>;
  appendTasteUpdate(u: TasteUpdate): Promise<void>;
  recentTasteUpdates(limit: number): Promise<TasteUpdate[]>;
}
```

**`Store` 是 server 侧的端口，永远不出现在渲染进程。** 前端拿到的是第 5 节的 JSON。
实现：`core/state/sqlite-store.ts`（better-sqlite3）。测试：`MemoryStore`。

### 3.6 Clock / EnvProvider / TasteRepo

```ts
export interface Clock { now(): Date }                       // 为了让调度器可测，禁止直接 new Date()
export interface EnvProvider {
  weather(at: Date): Promise<Weather | null>;
  calendar(day: string): Promise<CalendarEvent[]>;           // v1 恒返回 []
}
export interface TasteRepo { read(): Promise<TasteDoc>; appendLearned(line: string, evidence: TasteUpdate): Promise<void> }
```

### 3.7 Brain

```ts
export interface BrainInput { trigger: 'schedule' | 'chat' | 'track_end' | 'manual'; userText?: string; now: Date }
export interface Brain { think(input: BrainInput): Promise<Show> }
```

---

## 4. 数据契约（domain）

```ts
export interface Track {
  id: string; title: string; artist: string; album?: string;
  durationMs?: number; coverUrl?: string; source: string;
}
export interface TrackRef { id: string; title: string; artist: string }      // 队列里只带必要信息

export interface Show {                    // 一次推理的输出，对应原版 {say, play[], reason, segue}
  say: string[];          // 逐句口播，英文
  play: TrackRef[];       // 这几首
  reason: string;         // 给"我"看的理由（Profile 页可展示）
  segue: string | null;   // 衔接语，可为空
}
// ADR-0012：一句口播自带这一句的音频与词级时间戳（逐词高亮 + 口播进度的唯一真相）
export interface SpokenWord { text: string; startMs: number; endMs: number }   // 相对这一句音频起点
export interface SpokenLine { index: number; line: string; audioUrl: string; words: SpokenWord[] }
export interface DjMessage { id: string; ts: string; role: 'dj' | 'me' | 'system'; text: string; meta?: Record<string, unknown> }
export interface PlanBlock { start: string; end: string; mood: string; genres: string[]; tracks: TrackRef[] }
export interface DayPlan { date: string; createdAt: string; blocks: PlanBlock[]; active: boolean }
export interface PlayEvent {
  ts: string; songId: string; title: string; artist: string; source: string; level: QualityLevel;
  startedAt: string; endedAt: string | null; skipped: boolean; reason: string | null;
}
export interface PlayStats { played: number; skipped: number; replays: number; topArtists: { artist: string; count: number }[] }
export interface Lyric { lrc: string }
export interface TasteUpdate { ts: string; text: string; evidence: Record<string, unknown> }
export interface Weather { tempC: number; text: string }
export interface CalendarEvent { title: string; start: string; end: string }

// —— v1.1 补齐：第 5 节的 API 用到、但 v1.0 漏定义了的 DTO ——
export interface NowPlaying {
  track: Track | null;
  startedAt: string | null;                       // ISO 8601
  djState: 'idle' | 'thinking' | 'speaking';
  onAir: boolean;
  degraded: boolean;                              // 音乐源链路是否降级（第 6 节，UI 显示 DEGRADED 徽标）
}
export interface TasteDoc {
  corpus: { name: string; text: string }[];       // 人写的语料原文，只读（ADR-0004）
  recent: TasteUpdate[];                          // 系统学到的，结构化
}
export interface SettingsView {                   // 出参与入参分离：key 只回显「是否已配置」
  llm: { baseUrl: string; model: string; protocol: 'openai' | 'anthropic'; apiKeySet: boolean };
  tts: { provider: string; voice: string; apiKeySet: boolean };
}
export interface SettingsInput {
  llm?: { baseUrl?: string; model?: string; protocol?: 'openai' | 'anthropic'; apiKey?: string };
  tts?: { provider?: string; voice?: string; apiKey?: string };
}
```

**约定**：所有时间戳是 ISO 8601 字符串（不是 `Date`），因为要跨 HTTP 边界且要落库。所有 id 是 string。

---

## 5. API 契约（前后端唯一通道）

绑 `127.0.0.1`（单端，只服务本机），鉴权头 `x-radio-token`（挡住浏览器里其它页面误打这个端口的可能）。

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `/api/chat` | `{ text: string }` | `Show` |
| GET | `/api/now` | — | `NowPlaying` |
| GET | `/api/next` | — | `TrackRef[]` |
| GET | `/api/favorites` | — | `TrackRef[]` · 喜欢列表（[ADR-0010](adr/0010-playback-authority-and-favorites.md)） |
| GET | `/api/taste` | — | `TasteDoc`（4 份语料原文 + 最近 taste 更新） |
| GET | `/api/plan/today` | — | `DayPlan \| null` |
| POST | `/api/plan/regenerate` | `{ reason?: string }` | `DayPlan` |
| GET | `/api/audio/:songId` | `?level=` | 音频流（`206`/`200`，透传 Range） |
| GET | `/tts/<hash>.mp3` | — | 静态缓存文件 |
| GET | `/api/settings` | — | `SettingsView`（**key 与 cookie 都只回显是否已配置，绝不回显明文**，ADR-0005 / [ADR-0011](adr/0011-music-credential-in-settings.md)） |
| PUT | `/api/settings` | `Partial<SettingsInput>` | `SettingsView` · `music.cookie` 走这条写入；**写入的值覆盖 env** |
| POST | `/api/playback` | `{ songId, event: 'started' \| 'ended' \| 'skipped', at }` | `{ ok: true }` · `started` 同时是「切到这首了」（ADR-0010） |
| POST | `/api/feedback` | `{ songId, action: 'like' \| 'unlike' }` | `{ ok: true }` · 喜欢 / 取消（ADR-0010） |
| WS | `/stream` | — | 见下 |

> **歌词端点已删除**：`GET /api/lyric/:songId` 与 `Lyric` / `LyricResponse` 已经不在契约里（[ADR-0009](adr/0009-drop-lyric.md)）。
> mock、契约测试、renderer 里对应的面一并删了，所以它不会以「没人调的残留」的形式回来 —— 要重新加，先走一次需求（第 9 节）。

**两条路径的职责划清（v1 PC 单端）**

- `/api/audio/:songId` —— 渲染进程不直连外部音源：由 server 加上必需的请求头并透传 Range，
  同时把带签名的临时 URL 留在服务端。
- `/api/playback` —— 声音是在渲染进程里真正响的，所以「开始了 / 放完了 / 被跳过」由**渲染进程回报**，
  而不是 server 猜。`PlayEvent`（taste 闭环与统计的来源）因此是事实，不是预测（ADR-0007）。
- `/api/feedback` 与 `/api/favorites` —— 喜欢是**口味意图**，与播放事实分开走。
  `POST /api/playback { event: 'started' }` 已经承担了「我切到这首了」的宣告，所以**没有**单独的跳播端点（ADR-0010）。

**WS 事件（`StreamEvent`，单向 server→client）**

```ts
type StreamEvent =
  | { type: 'now';   payload: NowPlaying }
  | { type: 'say';   payload: SpokenLine }                         // 口播逐句推（带这一句的音频与词时间戳，ADR-0012）
  | { type: 'queue'; payload: TrackRef[] }
  | { type: 'plan';  payload: DayPlan }
  | { type: 'state'; payload: { onAir: boolean; djState: 'idle'|'thinking'|'speaking' } }
  | { type: 'error'; payload: { code: string; message: string; retryable: boolean } };
```

**所有错误统一信封**： `{ error: { code, message, retryable } }`，HTTP 状态码照常用。`code` 是一个封闭枚举（`NO_LLM_KEY`、`MUSIC_SOURCE_UNREACHABLE`、`MUSIC_NOT_RESOLVABLE`、`TTS_FAILED`、`RATE_LIMITED`、`INTERNAL`）。

**危险字段禁令**：`apiKey`、`MUSIC_U` 与**整条网易云 cookie 头**、DB 路径永远不出现在任何响应、日志与错误消息里。
`SettingsView` 只给 `{ llm: { baseUrl, model, protocol, apiKeySet }, tts: { provider, voice, apiKeySet }, music: { provider, cookieSet } }` —— 三块全是「配没配」，没有任何明文（ADR-0011）。

---

## 6. 降级与错误语义

| 环节 | 失败形态 | 处理 | 用户看到什么 |
|---|---|---|---|
| 取播放地址 | `resolve()` 返 `null` | 同曲降一档 `level` 重试（lossless→exhigh→higher→standard） | 无感（音质降低，`PlayEvent.level` 记录实际档位） |
| 取播放地址 | 全档位失败 | 换下一个 `MusicSource`；本曲标记 `skipped`，不排进队列 | DJ 用一句 `say` 说明"这首拿不到，换一首" |
| 全部音乐源 | 链路全空 | 电台进入 `degraded`，播本地兜底歌单；队列只保留能解析的 | 顶部 `ON AIR` 旁出现 `DEGRADED` 徽标 |
| 音乐 API 不通 | 抛错 | 同曲 1 次指数退避重试，再走上面的降级 | 同上 |
| TTS | 一次失败 | 退避重试 1 次；仍失败 → **跳过这句口播但继续放歌**（不阻塞音乐） | 聊天流里出现灰色占位 "…"，不弹错 |
| LLM | 一次失败 | 退避重试 1 次；仍失败 → 用上一次的 `Show` 重播队列，`djState` 回 `idle` | WS 推 `error`，Profile 页可见错误历史 |
| 未配置 key | 启动即知 | 不启动电台，UI 停在 Settings 并高亮缺失项 | 明确的"还差什么"提示，不是崩溃 |

**不变量**：任何单点失败都不允许让音乐停掉。这是电台的可用性底线。

---

## 7. 前端先行策略（铁律 3 的落地方式）

1. **第 0 步：冻结第 5 节**。契约进 `shared/api-types.ts`，任何改动都是 ADR 级别的改动。
2. **第 1 步：写 `mock/`**。一个 ~100 行的 Express，按第 5 节返回固定 fixture（含一个假的 `Show`、一个 3 段日表、10 首歌）。UI 全程对着它开发。
3. **第 2 步：UI 复刻**。Player 两态（宽窗大钟态 / 窄窗卡片态）、Profile、Settings、歌词同步。对着 mock 跑通所有态——包括上面的**全部降级态**（mock 可以直接切到 degraded、切到 error）。
4. **第 3 步：换真后端**。`core/server.ts` 实现同一个契约，UI 一行不改（只把 base URL 指过去）。
5. **第 4 步：契约回归**。一组契约测试同时打 mock 和真 server，断言两边响应结构一致。

**收益**：视觉问题在只有 mock 的时候就被发现并定案（铁律 4：自己拍板、对着参考源收敛），不会等到后端写完再返工。

---

## 8. 测试切入点

每个端口一个 fake，核心逻辑全部可以离线测：

| 端口 | 测试替身 | 能被验证的行为 |
|---|---|---|
| `LlmProvider` | `ScriptedLlm`（按脚本吐 tool_call / 文本 / 报错） | 工具循环、`submit_show` 协议、重试、超时 |
| `TtsProvider` | `FakeTts`（返回固定字节） | 缓存键、命中、失败降级 |
| `MusicSource` | `FakeMusic`（可控返回 null / 抛错） | 档位降级、源切换、`skip` |
| `Store` | `MemoryStore` | taste 闭环、plan 持久、统计 |
| `Clock` | `FakeClock` | 调度器时段选择（含跨午夜） |
| `EnvProvider` | `FakeEnv` | 环境注入了什么 |

外加：**契约测试**（第 7 节第 4 步）、**边界测试**（依赖规则，CI 跑一次静态检查）。

---

## 9. 不许做的事（反例清单）

- ❌ `renderer/` 里出现 `better-sqlite3`、`electron`、`node:fs`、`core/**` 的 import —— 违反铁律 5，CI 直接红。
- ❌ `core/brain/` 里 `new NeteaseSource()` —— 依赖倒置被破坏。
- ❌ 在 `core/` 里直接 `new Date()` 而不是注入 `Clock` —— 调度器将无法测试。
- ❌ 任何响应里回显 `apiKey` / `MUSIC_U` 明文。
- ❌ UI 里硬编码音乐源地址或 provider 逻辑 —— 那属于 Settings，不属于 UI。
- ❌ 让单点失败把音乐停掉。
- ❌ 为了"以后可能有用"提前加端口 —— 端口必须有第二个真实实现或明确的迁移计划。
- ❌ 只有一个客户端时做多端设计（选主、心跳、设备注册表、`lanAccess`）—— v1 只做 PC 单端（ADR-0007）。

---

## 10. 开放问题（已全部定案）

这 6 个问题在 v0.1 里被刻意留白——因为**带着未决问题写代码**（铁律 2）比停下来定案更贵。
现已逐条定案（v1.1 补上 ADR-0007 的范围修正），全部落成 ADR：

| # | 问题 | 结论（一句话） | ADR |
|---|---|---|---|
| 1 | `Show.play` 一次给一批还是逐首推进 | 一次给一批（3–6 首），调度器逐首消费；`chat` 触发的 Show 可清空并替换剩余队列 | [0001](adr/0001-show-play-batch.md) |
| 2 | `OutputTarget` 在 v1 是否空转 | **端口已删除**：v1 只做 PC 单端，没有第二个真实实现 | [0002](adr/0002-output-target-v1.md) → [0007](adr/0007-pc-only-single-output.md) |
| 3 | `lanAccess` 下多端同时播放要不要 leader | **问题本身撤回**：不做多端 | [0003](adr/0003-no-leader-election.md) → [0007](adr/0007-pc-only-single-output.md) |
| 4 | taste 写回 markdown 会不会格式漂移 | 不再回写：人写的 md 只读，系统学到的结构化存 SQLite | [0004](adr/0004-taste-stays-structured.md) |
| 5 | `Store.getPref<T>` 的泛型失真 | 去掉泛型，改成封闭 `PrefKey` + `PrefMap`，写入时显式校验 | [0005](adr/0005-typed-prefs.md) |
| 6 | 契约要不要 URL 版本化 | 不版本化：同进程同版本发布，靠契约测试保证一致 | [0006](adr/0006-no-api-versioning.md) |

**冻结声明**：第 5 节的 API 契约自本版本起是 **v1.0 基线**。改契约 = 开 ADR。
