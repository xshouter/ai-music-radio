# ADR-0030 · 日表从日推来：同一套工具环，换一个终局工具

- **状态**：已接受
- **日期**：2026-10-21
- **关联**：`core/plan.ts`、`core/brain/index.ts`、`core/prompt.ts`、`core/radio.ts`、
  `tests/core/plan.test.mjs`、`tests/core/brain.test.mjs`、`tests/core/radio.test.mjs`；
  ADR-0015、ADR-0024、ADR-0025
- **需求**：`docs/requirements/daily-plan.md`

## 背景

用户的待办：「llm 可以根据网易云音乐的每日推荐歌单来生成歌单吗」。

摸底发现题面不是「接一个新上游」：`netease.recommend` 早就会打 `/recommend/songs`（就是日推），
但**只有场景词为空时**才走；而 `buildDayPlan` 每一格都带着 `genres + mood`，于是每一格都落在
`/cloudsearch` 上 —— **接口一直在，进日表的那条路从来没被走过**。

grill（Q1–Q5，记录在需求文档里）定了两件关键的事：

- 日推是**候选池**，不是歌单本身：挑、排序、分配到三个时段由 LLM 做；
- 「能从日推，**也允许自己搜**」。

第二句直接决定了实现形状：这一轮**必须是能调工具的一轮**。一次裸 completion 里，
模型没法「搜一下再决定」。

## 决策

**① 复用工具环，只换终局工具。** `ToolLoopBrain` 里那段循环抽成 `loop<T>()`；`think()` 与新的
`plan()` 是同一台机器的两个入口 —— 工具集不同（`TOOLS` / `PLAN_TOOLS`）、终局不同
（`emit_show` / `emit_plan`）、参数校验器不同（`readShow` / `readPlan`）。
两者共用的只有那句脾气：**在模型自己说「完了」之前不接受任何结论** ——
这句话只有一份实现。**`TOOLS` 一个字都没动**：播歌那一轮仍是封闭的五件，
排表另给一份 `PLAN_TOOLS`，两条流水线互不欠账。

**② `daily_recommend` 就是「没有场景词」那条路。** 它调 `music.recommend({}, limit)` ——
语义上正是日推（netease 源：无场景词 → `/recommend/songs` → 退 `/personalized/newsong`）。
不新增来源、不改链、不碰 ADR-0016 的两级退让。

**③ 校验同源、但宽松。** `blocks` 里的 id 必须是本轮工具真的返回过的（与 `emit_show` 同一条铁律），
但**不照搬** `MIN_TRACKS = 3`：日表是草图，一格空着不算坏。只认前 N 个块，
多出来的块忽略 —— 三格是产品的脾气，不是模型的输入。

**④ 排不出来就退到搜索，一层兜一层。** `buildDayPlan` 多了一个**可选**的 `curate`：
没有它 = 原来那个逐格搜索；有它就整份 `.catch(() => null)`，缺哪格补哪格。
没配 LLM key 时连这一轮都不发（`planCurator` 直接回 null）—— 白等一轮没有意义。

## 后果

- **好处**：日表从「按场景词搜出来的三格」变成「从他自己的日推里挑出来的三格」，
  而且它**真的会看**最近跳过/重听了什么（Q4）—— `gather()` 早就在做这件事，这一轮白拿。
- **好处**：排表失败不会被任何用户看见。整轮失败 / 模型吐坏 JSON / 日推拿不到 ——
  三种都落在同一个 `.catch` 上，退到搜索，`ensureTodayPlan` 的语义没变（ADR-0024）。
- **代价**：`ToolLoopBrain` 那段循环动了一次手术（`think` 变薄、`loop` 变通用）。
  敢动它的理由是它同时被 5 条 brain 测试盯着，而且**行为必须逐字保持**（错误消息、驳回文案、
  最后一步强制定稿，一个都没改）。
- **代价**：开机多了一轮 LLM 调用（先排表、再开口）。用户要的正是这个顺序。
- **`shortcut:`** 排表的提示词里写死「每格 3 首」，`perBlock` 换别的值时提示词不跟着变；
  真要支持就把 `perBlock` 传进 curator。
- **已知限制**：`PLAN_TOOLS` 里没有 `recommend_tracks`（场景词搜索）—— `search_tracks`
  已经覆盖「按曲风搜」这件事。少一个工具，少一次模型瞎逛的机会。