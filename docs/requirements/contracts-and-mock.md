# 需求：契约与 mock（阶段 2）

> 铁律 2 的产物。**这份文件在写第一行代码之前落盘**，状态：已定案。
> 上游依据：`docs/abstraction-layer.md` 第 4 / 5 / 7 / 8 节，`docs/adr/0001…0007`。

## 目标

在**没有任何后端**的前提下，让界面能对着一个假后端跑通全部状态；
同时把前后端唯一的真相（API 契约）冻成可以编译的代码。这是铁律 3 的第 0–1 步。

## 交付物

| 文件 | 内容 |
|---|---|
| `shared/domain.ts` | 领域类型：`Track` / `TrackRef` / `Show` / `DayPlan` / `PlayEvent` / `TasteUpdate` … |
| `shared/api-types.ts` | 第 5 节的请求 / 响应 DTO、`StreamEvent`、错误信封、`NowPlaying` / `TasteDoc` / `SettingsView` / `SettingsInput` |
| `mock/server.mjs` | 零依赖（Node 内建 `http`）假后端，按第 5 节契约返回固定 fixture |
| `tests/contract/mock.test.mjs` | 契约测试：对着 mock 断言响应结构（也支持 `RADIO_BASE_URL` 指到真 server）；真 server 那一份在 `tests/core/radio.test.mjs` |
| `tsconfig.json` + `typescript`（devDependency） | 契约是要被编译的，否则 .ts 只是带装饰的注释 |

## 范围

**做**
- 契约类型（纯类型，零运行时依赖——铁律 5 的边界检查会盯着这一点）
- mock 的第 5 节**全部**端点，包括错误信封
- mock 能整体切到 `degraded`，并能逐项触发每个错误码（`NO_LLM_KEY` / `MUSIC_SOURCE_UNREACHABLE` /
  `MUSIC_NOT_RESOLVABLE` / `TTS_FAILED` / `RATE_LIMITED` / `INTERNAL`）
- 固定 fixture：1 个假 `Show`、3 段日表、10 首歌、2 条 taste 更新
- 契约测试跑通

**不做**
- 任何真实 LLM / TTS / 音乐源调用
- 数据库、调度器、大脑、Electron
- 界面（那是阶段 3，本阶段结束时 `renderer/` 仍然是空的）

## 已定决策（引用，不在这里重新讨论）

- 契约不版本化，唯一真相是 `shared/api-types.ts`（ADR-0006）
- `Show.play` 一次给一批，3–6 首（ADR-0001）
- 没有输出设备端口，声音只在渲染进程响，所以 `POST /api/playback` 必须在 mock 里就有（ADR-0007）
- taste 分两块：人写的语料只读 + 结构化更新（ADR-0004）
- 设置项是封闭 key，写入时显式校验（ADR-0005）

## 写下来的假设

1. **UI 只换一个 base URL 就能从 mock 切到真 server** —— 所以 mock 与真 server 用同样的路径、同样的字段名，
   mock 不得为了方便而增删字段。
2. **mock 的 `say` 必须逐句推**（`WS /stream` 逐条 `say` 事件），不能一次性把整段发完；
   否则 UI 的"逐句浮现"在 mock 上根本跑不出来，等真后端才发现。
3. mock 的音频用**内存里生成的静音 WAV**，仓库里不放任何真实音频文件。
4. 契约测试只断言**结构与枚举取值**，不断言具体内容——内容是 fixture，允许随便改。

## 验收标准

- [x] `node mock/server.mjs` 能起来，`GET /api/now` 直接请求有响应
- [x] 第 5 节的每个端点都能被 mock 响应；错误路径返回统一信封 `{ error: { code, message, retryable } }`
- [x] 一个开关即可切到 `degraded`，且每个错误码都能单独触发——UI 不需要改一行代码就能显示对应状态
- [x] `npm test` 全绿（契约测试）
- [x] `npm run typecheck` 全绿
- [x] `node tools/check-boundaries.mjs` 全绿（`shared/` 仍是纯类型）
- [x] `renderer/` 里一行代码都没有