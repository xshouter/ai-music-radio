# 路线图（Roadmap）

> **目标**：2 天内做出可演示的 demo，最终交付一个别人下载后填自己 API key 就能用的 Windows exe。
> **顺序**受铁律 3 约束：冻结契约 → mock → UI → 换真后端。**后端不许插队**。
> **规则**：一个 PR 只做一件事，每个 PR 都能被单独读懂、单独回滚。

## 阶段 0 · 地基

| 顺序 | 分支 | 内容 | 状态 |
|---|---|---|---|
| 0.1 | `docs/abstraction-layer` | 抽象层设计 + 五条铁律细则 | ✅ 已合并（PR #2） |
| 0.2 | `chore/repo-foundation` | PR 模板、ADR 模板、边界检查脚本 + CI、journal、references、roadmap、README | ✅ 已合并（PR #3） |

## 阶段 1 · 冻结抽象层

| 顺序 | 分支 | 内容 | 状态 |
|---|---|---|---|
| 1.1 | `docs/decide-open-questions` | ADR-0001…0007 定掉抽象层第 10 节的 6 个开放问题 + 一次范围修正（ADR-0007） | ✅ 已合并（PR #4、#5） |
| 1.2 | `feat/own-adapters` | 第 3 节的端口从文档落成 `shared/ports.ts`（纯类型）+ 两条契约级决策：ADR-0008 TTS 用 Fish Audio、ADR-0009 v1 不做歌词 | ✅ 已合并（PR #11） |

**门槛**：这一阶段不完成，不许写第一行代码（铁律 2）。**已满足 → 阶段 2 可以开始。**

> 1.2 是**补做**：1.1 时端口只活在文档里，落地时才发现有一处编译不过（见 `docs/abstraction-layer.md` 第 3 节）。
> 它不影响阶段 2 / 3 的既有结论——契约（`shared/api-types.ts`）与端口（`shared/ports.ts`）是两份文件，前者早已冻结。

## 阶段 2 · 契约与 mock

| 顺序 | 分支 | 内容 | 状态 |
|---|---|---|---|
| 2.1 | `feat/contracts-and-mock` | `shared/`（前后端唯一真相，可编译）+ `mock/`（零依赖假后端：1 个假 Show、3 段日表、10 首歌，可切降级态与错误态）+ 契约测试 | ✅ 已合并（PR #8） |

## 阶段 3 · UI 复刻（本项目的重心）

| 顺序 | 分支 | 内容 | 状态 |
|---|---|---|---|
| 3.1 | `feat/ui-player` | Player 两态：宽窗大钟态 / 窄窗卡片态；歌词逐行高亮；口播逐句浮现 | ✅ 已合并（PR #10）。**已被 3.2 取代**：两态与歌词都不对，理由见下 |
| 3.2 | `docs/ui-player-v2-requirement` | 需求重写：单态等比缩放、去掉歌词、补齐歌单 / 喜欢 / DJ 详情 / 口播界面 | ✅ 已合并（PR #12） |
| 3.3 | `feat/contracts-favorites` | 冻结契约增量 P1–P4（喜欢 / 队列跳播语义 / `TasteDoc.genres`）+ ADR-0010 | ✅ 已合并（PR #13） |
| 3.4 | `feat/contracts-credentials` | 需求按 4 条答复打补丁 + 冻结契约增量 P5（网易云凭证）+ ADR-0011 + mock + 断言 | ✅ 已合并（PR #14） |
| 3.5 | `feat/drop-lyric` | 还 ADR-0009 的债：歌词链路从契约 / mock / 测试 / renderer 里一并删除 | ✅ 已合并（PR #15） |
| 3.6 | `feat/ui-player-v2` | Player 布局重做：基准 **616×876** 等比缩放的单态布局 + DJ 详情弹层 | ✅ 已合并（PR #16） |
| 3.7 | `feat/ui-queue-sources` | QUEUE 双来源切换（`AI 推荐` / `FAV`）+ 喜欢列表的行内 `✕` 删除与 `UNDO` | ✅ 已合并（PR #17） |
| 3.8 | `feat/ui-now-playing` | 口播界面全屏态：真波形 + 逐词高亮 + 56 格进度 | ✅ 已合并（PR #18） |
| 3.9 | `feat/ui-credentials-modal` | `LOGIN` → 凭证弹窗（LLM / TTS 的 key + 网易云 cookie） | ✅ 已合并（PR #19） |
| 3.10 | `feat/contracts-profile` | 契约增量 P6：`GET /api/stats` + `GET /api/history`（ADR-0013）+ mock 开始记账 + 断言 | ✅ 已合并（PR #20） |
| 3.11 | `feat/ui-profile` | Profile：taste 语料、收听统计、口播历史、`plan` 的去处 | ✅ 已合并（PR #21） |
| 3.12 | `fix/ui-button-ink` | 插队补丁：按钮小字 `--text-dim` → `--btn-text`；15px 以下的 Doto 回 `--label` | ✅ 本 PR |

> 3.10 是**契约增量**（P6），跟 3.3 / 3.4 一个道理：先冻结再加界面；3.11 才是 Profile 本身。
> 3.1 为什么被推翻：它是一个「能跑起来的电台界面」，不是「和参考分不出来的电台界面」。
> 两态响应式意味着永远有一个态不是参考的样子；歌词则是 ADR-0009 已经砍掉的成本。
> 3.5 是第一个动 `renderer/` 的 PR，但它只做删除（歌词链路），布局一行没动——所以 3.1 的界面在 `main` 上继续可用。
> 3.6 才换布局模型，那时界面会第一次和参考对齐。
> 基准尺寸已定：**616×876**，取自参考源站点口播卡片的真值。

**门槛**：UI 必须对着 mock 跑通**全部**状态，含抽象层第 6 节列出的所有降级 / 错误态（铁律 3）。
所有拿不准的视觉细节自己拍板、对着参考源收敛（铁律 4）。

## 阶段 4 · 真后端（内核）

| 顺序 | 分支 | 内容 |
|---|---|---|
| 4.1 | `feat/core-store` | `core/state/sqlite-store.ts` + 迁移 + `Store` 的内存测试替身 + `core/tsconfig.json` | ✅ 本 PR（#23） |
| 4.2 | `feat/core-brain` | 自建 tool loop + `LlmProvider` 抽象（OpenAI 兼容 / Anthropic 兼容两个实现） |
| 4.3 | `feat/music-chain` | `MusicSourceChain` + 网易云实现 + 本地兜底 |
| 4.4 | `feat/tts-pipeline` | `core/tts.ts` 缓存 + 两个 `TtsProvider` 实现 |
| 4.5 | `feat/scheduler-and-serving` | 调度器（`Clock` 注入）+ `core/server.ts` 实现第 5 节的全部契约 |

> 4.3 / 4.4 走**自建适配层**：只借鉴公开实现的做法，用本项目自己的端口与抽象重写，**不内联任何第三方代码**。
> 4.1 顺手定了两件基建：`core/` **不认具体 SQLite 驱动**（结构化接口 + `main/` 注入，见 ADR-0014），
> 以及 CI 的 Node 从 22 提到 24（`node:sqlite` 在 22 上要 `--experimental-sqlite`，本地却不用 —— 这是最容易分叉的地方）。

**门槛**：切到真后端时 UI **一行不改**，只换 base URL。改了 UI 就说明契约没冻结住。

## 阶段 5 · 打包与发布

| 顺序 | 分支 | 内容 |
|---|---|---|
| 5.1 | `chore/electron-shell` | Electron 外壳：唯一组装点、窗口、托盘、本地播放 |
| 5.2 | `chore/release-pipeline` | Actions 自动构建 Windows exe 并发 Release；**exe 内不含任何凭证** |

## 贯穿全程的两件事

- **契约回归**：同一组契约测试同时打 `mock/` 与 `core/server.ts`，断言两边响应结构一致（抽象层第 7 节）。
- **边界检查**：每次 CI 跑 `node tools/check-boundaries.mjs`，`renderer/` 越界即红（铁律 5）。