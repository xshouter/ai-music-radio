# ADR-0010 · 播放权威在客户端：喜欢与队列跳播的契约面

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`docs/requirements/ui-player.md`（3.2 需求）、`shared/api-types.ts`、`shared/ports.ts`、
  `docs/abstraction-layer.md` 第 5 节、ADR-0007、ADR-0009

## 背景

3.2 的 UI 需求里有两条交互落不了地，因为契约里没有它们的位置：

- **`♡` 喜欢当前曲 / `FAV` 打开喜欢列表** —— 契约里既没有读喜欢列表的出口，也没有写入的动作。
- **点 QUEUE 某一行 → 切到那首歌** —— 没有任何端点能表达「现在改播这首」。

还有一条更根本的：`POST /api/playback` 的**语义没写清**。ADR-0007 定了
「PC 端由渲染进程直接播放 `<audio src="/api/audio/:songId">`」，但没有写这句话的后果。

不决策会怎样：

1. UI 只能猜喜欢放哪 —— 而前端唯一合法的存放处是后端（铁律 5：前端不碰数据库/存储）。
2. `GET /api/now` 说的和在响的那首歌会**各说各话**：server 以为在播队列第 1 首，客户端已经因为用户点了第 4 行而在播第 4 首。
3. 「DJ 详情里那排曲风胶囊」只能硬编码在 UI 里，`taste` 就变成了贴纸。

## 决策

**一、播放权威在客户端。**

渲染进程决定现在播哪首（换 `<audio>` 的 `src`），server 只记账。
于是 `POST /api/playback { event: 'started' }` **同时**是两件事：

- 「这首开始响了」（`PlayEvent` 的来源，taste 闭环与统计的输入）；
- 「我切到这首了」（server 据此更新 `now`，并在 WS 上推 `now`）。

点 QUEUE 某行、点 DJ 消息里的曲目卡、点 `⏭`，走的都是这一条，**不新增端点**。

**二、喜欢是独立的契约面。**

| 端点 | 请求 | 响应 |
|---|---|---|
| `GET /api/favorites` | — | `TrackRef[]` |
| `POST /api/feedback` | `{ songId, action: 'like' \| 'unlike' }` | `{ ok: true }` |

`action` 是**封闭枚举**。`like` / `unlike` 都**幂等**。

**三、`♡` 的选中态由客户端算，`NowPlaying` 不加 `liked` 字段。**

UI 拿一次 `GET /api/favorites` 就有全集，用它做成员判断；喜欢成功后本地乐观更新。

**四、`TasteDoc` 加 `genres: string[]`。**

DJ 详情弹层里那排曲风胶囊是**数据**：它必须随语料变，不然「有 taste」这件事就只是排版。

**五、端口同步（抽象层第 9 节：先有需求，再加端口）。**

`Store` 加 `favorites()` 与 `setFavorite()`。存 `TrackRef` 而不是 `songId`：
v1 没有 `songs` 表，而列表 UI 需要曲名与歌手。

**边界（什么时候这条决策不适用）**

- 出现**第二个真实播放目标**时（ADR-0007 的重新打开条件），「谁决定在播什么」要重新讨论。
- 出现**多人共用一台电台**时，`LISTENER 1` 不再成立，`favorites` 要带 owner，`♡` 的客户端算法也会失效。
- 本 ADR **不顺手删歌词**：ADR-0009 已指定那笔清理落在 UI 重做 PR，理由同样成立（一起删会让 CI 中间态变红，且本 PR 无法单独读懂）。

## 后果

- **好处**：
  - 一条链路决定「在播什么」，两边不会各说各话；
  - 喜欢落在后端，前端不碰存储（铁律 5），换机器不丢；
  - `/api/feedback` 与 `/api/playback` 同构（都是「客户端报告一个事实」），将来要加 `dislike` 只是加一个枚举值，不新增端点；
  - 曲风胶囊有了数据来源，`taste` 是活的。
- **代价**：
  - `started` 一个事件承担两个语义（记账 + 宣告）。读 mock 的人可能先困惑一次 —— 所以契约与 mock 都就地写了注释。
  - `♡` 的选中态是客户端算的：单端下没有问题，但它是一处**已知的、有条件的**不一致（见上面的边界）。
  - `genres` 进了 `TasteDoc` 之后，实现侧必须真的**从语料里读出来**。读不出来还硬塞 9 个常量，就白加了。
- **重新打开的条件**：出现第二个播放目标，或出现第二个听众。

## 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 新增 `POST /api/queue/play` 专做跳播 | 同一件事两个端点：一个说「开始放了」、一个说「切过去」。两处都要更新 `now`，必然漂移 |
| 把 `liked` 塞进 `NowPlaying` | 同一事实两处存：喜欢列表变了要重算 `now`，`now` 变了又要重取喜欢。单端下它换不来任何收益 —— UI 一次 `GET /api/favorites` 就有全集 |
| 喜欢存前端（`localStorage`） | 违反铁律 5；换台机器就丢；而且它本该进 taste 闭环 |
| 复用 `POST /api/playback { event: 'skipped' }` 当「不喜欢」 | 跳过 ≠ 不喜欢：跳过常常只是「现在不想听这首」。混起来会污染 taste 的证据链 |
| 曲风胶囊在 UI 里写死 9 个常量 | 「taste」变成贴纸，而且它必须能随语料变 |
| 现在就把歌词那条线一起删 | ADR-0009 已经指定删除落在 UI 重做 PR（见上「边界」） |

## 落地清单

- [x] `shared/api-types.ts`：`TasteDoc.genres`、`FeedbackRequest` / `FavoriteAction`、`FavoritesResponse`、`PlaybackReport` 的注释
- [x] `shared/ports.ts`：`Store.favorites()` / `Store.setFavorite()`
- [x] `mock/server.mjs`：`GET /api/favorites`、`POST /api/feedback`、`TASTE.genres`
- [x] `tests/contract/mock.test.mjs`：4 条新断言
- [x] `docs/abstraction-layer.md` 第 5 节：两张表就地补行
- [ ] 未落地：`renderer/` 的三个入口（`♡` / `FAV` / 点行切歌）—— 属于 UI 重做 PR