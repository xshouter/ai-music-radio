# ADR-0013 · Profile 的两个只读端点（`GET /api/stats`、`GET /api/history`）

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：PR #20 ／ `docs/requirements/ui-profile.md`（阶段 3.10/3.11）、`shared/api-types.ts`、
  `shared/ports.ts`（`Store.playStats` / `Store.recentMessages`）、ADR-0004（taste 结构化）、ADR-0010（播放权威在客户端）

## 背景

Profile 是日表（`plan`）的**唯一去处** —— `docs/requirements/ui-player.md` 交互决策 8 明确「日表不放进 Player，
去处写进 Profile」。它同时要装下另外两块：**收听统计**与**口播 / 聊天历史**。

三块数据里只有一块在 HTTP 契约里有出口：

| 要显示的东西 | 数据源（端口） | 契约里有出口吗 |
|---|---|---|
| taste 语料 + 学到的更新 | `TasteRepo.read()` | ✅ `GET /api/taste` |
| 今天的日表 | `Store.activePlan()` | ✅ `GET /api/plan/today` |
| 收听统计 | `Store.playStats(since)` | ❌ 只有端口方法 |
| 口播 / 聊天历史 | `Store.recentMessages(limit)` | ❌ 只有端口方法 |

`shared/ports.ts` 里这两个方法从抽象层第 3 节起就在，只是从没有 HTTP 出口 —— 于是 UI 拿得到「现在播什么」，
拿不到「我这些天听了什么」。而「taste 会随听歌变」正是这个项目要证明的事：没有统计就没有变化可看，
Profile 会退化成一块静态语料。

## 决策

只加两个**只读**端点，返回形状直接等于既有端口方法的返回类型，不新增 DTO：

```
GET /api/stats?since=<ISO 日期，可选>   -> PlayStats
GET /api/history?limit=<1..200，可选>   -> DjMessage[]
```

边界：

- 都**只读**，没有对应写端点。写只发生在既定端点内部：`POST /api/playback` 记播放、`POST /api/chat` 记消息。
- `since` 省略 = **当天 00:00（服务器本地时区）**。口径要能被 UI 说明白：「今天的收听」。
- `limit` 省略 = 50，上限 200；越界就**夹住**而不是报错 —— 错误码是封闭枚举，里面没有「参数不合法」这种码。
- `history` 按时间**倒序**（最新在前），UI 直接渲染，不自己排序。
- 不改 `DjMessage.meta` 的形状：Profile 只读 `role` / `text` / `ts`（`meta` 仍是 `Record<string, unknown>`）。

## 后果

- **好处**：
  - Profile 的三块数据全部有契约出口，UI 不为「数据从哪来」写特判。
  - 阶段 4 的实现是现成的：`Store.playStats` / `Store.recentMessages` 直接接上，不需要新表、新端口。
  - 「taste 随听歌变」从口号变成看得见的数字（播放 / 跳过 / 重播 / Top 艺人），可以当场演示。
- **代价**：契约面多两个只读端点；mock 必须开始**真的记账**（此前 `POST /api/playback` 是空实现），
  否则统计永远是 0，那一版 UI 等于没验。
- **重新打开的条件**：Profile 要做「按月 / 按艺人下钻」时，单个 `since` 不够用，那时再谈分组查询端点。

## 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 把统计塞进 `GET /api/now` | `/api/now` 是会被高频轮询的「当前状态」，统计是慢查询；混进去等于每次轮询都打一遍库 |
| 新增 `GET /api/plays` 返回原始 `PlayEvent[]`，让 UI 自己聚合 | 同一件事两个实现（mock 与真后端必有细微不一致）；聚合属于 `Store`，历史越长 payload 越大 |
| 用 `WS /stream` 推统计 | 统计没有「实时」语义；推它只是给 UI 定期噪声，拉取足够 |
| 前端把 plays 拉下来自己算 | 违反铁律 5 的精神：聚合、排名这类事不该出现在渲染进程 |