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
| 1.1 | `docs/decide-open-questions` | ADR-0001…0006 逐条定掉抽象层第 10 节的 6 个开放问题，抽象层升 v1.0 | ✅ 本次 |

**门槛**：这一阶段不完成，不许写第一行代码（铁律 2）。**已满足 → 阶段 2 可以开始。**

## 阶段 2 · 契约与 mock

| 顺序 | 分支 | 内容 |
|---|---|---|
| 2.1 | `feat/contracts-and-mock` | `shared/api-types.ts`（前后端唯一真相）+ `mock/`（约 100 行：1 个假 Show、3 段日表、10 首歌，可切降级态与错误态） |

## 阶段 3 · UI 复刻（本项目的重心）

| 顺序 | 分支 | 内容 |
|---|---|---|
| 3.1 | `feat/ui-player` | Player 两态：宽窗大钟态 / 窄窗卡片态；歌词逐行高亮；口播逐句浮现 |
| 3.2 | `feat/ui-profile-settings` | Profile（taste 语料、收听统计、口播历史）与 Settings（key 输入、模型与 TTS 音色） |

**门槛**：UI 必须对着 mock 跑通**全部**状态，含抽象层第 6 节列出的所有降级 / 错误态（铁律 3）。
所有拿不准的视觉细节先要参考截图（铁律 4）。

## 阶段 4 · 真后端（内核）

| 顺序 | 分支 | 内容 |
|---|---|---|
| 4.1 | `feat/core-store` | `core/state/sqlite-store.ts` + 迁移 + `Store` 的内存测试替身 |
| 4.2 | `feat/core-brain` | 自建 tool loop + `LlmProvider` 抽象（OpenAI 兼容 / Anthropic 兼容两个实现） |
| 4.3 | `feat/music-chain` | `MusicSourceChain` + 网易云实现 + 本地兜底 |
| 4.4 | `feat/tts-pipeline` | `core/tts.ts` 缓存 + 两个 `TtsProvider` 实现 |
| 4.5 | `feat/scheduler-and-serving` | 调度器（`Clock` 注入）+ `core/server.ts` 实现第 5 节的全部契约 |

**门槛**：切到真后端时 UI **一行不改**，只换 base URL。改了 UI 就说明契约没冻结住。

## 阶段 5 · 打包与发布

| 顺序 | 分支 | 内容 |
|---|---|---|
| 5.1 | `chore/electron-shell` | Electron 外壳：唯一组装点、窗口、托盘、本地播放 |
| 5.2 | `chore/release-pipeline` | Actions 自动构建 Windows exe 并发 Release；**exe 内不含任何凭证** |

## 贯穿全程的两件事

- **契约回归**：同一组契约测试同时打 `mock/` 与 `core/server.ts`，断言两边响应结构一致（抽象层第 7 节）。
- **边界检查**：每次 CI 跑 `node tools/check-boundaries.mjs`，`renderer/` 越界即红（铁律 5）。