# ADR-0027 · 错误码说真话：上游怎么坏就报哪个码，而且要说得出口

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`core/radio.ts`、`core/music/index.ts`、`core/http.ts`、`main/main.ts`、`renderer/src/App.tsx`；ADR-0015、ADR-0016、ADR-0019

## 背景

一次真实试用，反馈只有一句：**好像没有和 llm 连接上**。查下来是一环扣一环：

1. 网易云的兼容服务（ADR-0016）没在跑，本地音乐目录又是空的 —— 音乐源实际上**不在**。
2. 降级链把「两个源都没拿到」收敛成空结果（这是它该做的）。
3. 大脑拿不到任何 track id，模型只好编，`emit_show` 的校验（ADR-0015）把它们全部驳回。
4. 推理以 `brain: emit_show 始终不合法 —— unknown track id(s) […]` 收场。

而这句真话被报成了 `INTERNAL`，UI 上写「Something broke inside the station.」。
**错的是音乐源，被指控的是电台自己。**

同一个毛病还有三处：

- `core/http.ts:48` 的注释写着「429 与 401 要分开处理（RATE_LIMITED vs NO_LLM_KEY）」，**全仓库没有一处实现它**：上游 401 一律走 `INTERNAL`。
- 封闭枚举里的 `RATE_LIMITED` 与 `MUSIC_SOURCE_UNREACHABLE` **一次都没被发出过** —— 码是封闭的，但有两个是死的。
- 更彻底的一处：`main/main.ts` 是**先 `await boot()`、窗口才建起来**，所以开场失败那条事件**一个订阅者都没有**。
  就算把码报对了，用户也永远看不到。

## 决策

**① 上游 HTTP 的错按状态定名。** 401/403 → `NO_LLM_KEY`（和「没配 key」是同一件要修的事：换一个），
429 → `RATE_LIMITED`，其余 → `INTERNAL`（词表就这么大，没有第七个码）。

**② 音乐源不可达不许被说成「没这首」。** 降级链在「全空手而归、且至少有一个源是**抛错**走的」时喊一次
`onUnreachable`（新增可选参数，默认不喊）。**只是没搜到不算** —— 源答了话就不是不可达。

**③ 归因只看区间。** `radio` 里一个**单调计数** `sourceFailures`：一次推理记下起点，收场时「涨过没有」
决定要不要报 `MUSIC_SOURCE_UNREACHABLE`。用计数不用布尔 —— 一次偶发失败不许把后面无关的失败都算到音乐源头上。

**④ 失败定名收在一处。** `nameFailure(cause, sourceDown)`：先认 `RadioFailure`，再认 `HttpError`，
再认「这一段见过源不可达」，最后才是 `INTERNAL`。`think()` / `boot()` / `resolveAudio()` 都走它。

**⑤ 失败要说得出口。** `radio` 记住最后一条「还没被好的一轮抵掉」的错误，`subscribe()` 的快照带上它，
`applyShow()`（有一轮真的成了）把它清掉。**这一条不是锦上添花**：没有它，①…④ 修好的码仍然到不了用户眼前。

## 后果

- **好处**：同一场故障的文案从「电台内部炸了」变成「音乐源没在答话」—— 用户知道该去起兼容服务，而不是怀疑自己填错了 key。
- **好处**：两个死码活了；`core/http.ts:48` 的注释不再是空头承诺；开场失败也有出口。
- **代价**：链多一个可选参数；归因从一个「布尔直觉」变成「要维护一个计数 + 一个待办横幅」。
- **代价**：`INTERNAL` 仍会被上游 5xx 用到 —— 枚举里没有 `UPSTREAM_FAILED`，这是词表的既有边界（与「未知路由用 `INTERNAL`」同一个先例）。
- **已知限制**：`resolveAudio()` 用「这一次解析涨没涨」来分 `MUSIC_SOURCE_UNREACHABLE` 与 `MUSIC_NOT_RESOLVABLE`；
  同进程里并发的另一轮推理也会推高计数 —— 两个码都指向「音乐坏了」，误判的代价是文案而不是行为。
- **已知限制**：`lastError` 只留最后一条，UI 也只有一个横幅位；同时坏两处时只会看到后发生的那条。
- **重新打开的条件**：真给枚举加第七个码（`UPSTREAM_FAILED`）时，①的兜底要跟着改。
