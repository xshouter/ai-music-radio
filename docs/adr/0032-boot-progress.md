# ADR-0032 · 开机进度：窗口先出生，进度是累积快照

- **状态**：已接受
- **日期**：2026-10-21
- **关联**：`shared/api-types.ts`、`core/radio.ts`、`main/bootstrap.ts`、`main/main.ts`、
  `renderer/src/components/BootProgress.tsx`、`renderer/src/hooks/useRadio.ts`、`renderer/src/App.tsx`、
  `mock/server.mjs`、`tests/contract/mock.test.mjs`、`tests/main/bootstrap.test.mjs`；ADR-0024、ADR-0029、ADR-0030
- **需求**：`docs/requirements/plan-progress.md`

## 背景

ADR-0030 / ADR-0031 把排表做进了开机的第一件事，真数据实测 14–28s。用户双击图标之后看到的是**屏幕上什么都没有**。

排表本身没有可看的进度 —— 但这一轮摸底发现，缝比「进度条不好看」更靠前：**窗口还没出生**。
`main/bootstrap.ts` 的 `startRadio` 要 `await radio.boot()` 完才 return，`main/main.ts` 拿到返回值才 `new BrowserWindow`。
也就是说这 14–28s 里连那个壳都不存在。修时序才是这一轮真正要做的事，进度界面只是它的副产品。

第二件事：进度从哪来。brain 的工具环早就在 `onStep` 里一格一格上报（`ToolStep = { index, tool, args, result }`），
`core/radio.ts` 的 `harvest` 也早接到了。但它报的是**工具名**（`search_tracks`），不是**用户看得懂的事**。

## 决策

**① 窗口先出生：`startRadio` 不再 await boot。** `StartedRadio` 多一个 `boot(): Promise<void>`，
由 `main.ts` 在 `win.loadURL(...)` **之后**发动、**不 await**（失败只留一行 `console.error`）。
一个 14–28s 的黑屏不是「等一会」，是「这软件坏了」—— 所以先有壳，再有活干。

**② 进度是「累积快照」，不是「增量日志」。** 载荷 `BootProgress = { phase, steps: BootStep[] }`，
`steps` 是**到目前为止出现过的全部步骤**（按首次出现顺序、同一个 id 只出现一次）。
晚连上来的窗口补收一条就对齐了：不需要重放、不需要序号、不需要问「我漏了第几条」。
`subscribe()` 的快照里也补推一条 `running` —— 于是「窗口刚出生」和「中途重连」走的是同一条路。

**③ 只盖 `boot()` 这一段。** `booting` 是个开关，`boot()` 进来置真、`finally` 里置假；聊天与切歌一条进度都不发。
结束条件两条，任一条到就结束：第一句 `say` 出去（`kind === 'intro'`），或者 `boot()` 收尾（没 key / 失败）。
**界面永远不许挂住** —— 卡在 `running` 的进度比不显示更糟。

**④ 步骤 id 是 UX 概念，不是工具名。** `BootStep` 只有五个：`daily-pool` / `recent-plays` / `deep-search` /
`draft-plan` / `opening-line`。`bootStepOf(tool)` 负责翻译（`emit_plan` → `draft-plan`）。
工具以后改名、拆开、合并，界面文案不用跟着动；界面想要的叙事顺序也不必等于工具的实现顺序。
两层之间只靠这一张小映射表解耦。

## 后果

- **首次开机的黑屏消失。** 代价是 `boot()` 的失败从此不阻塞窗口：一个坏掉的 key 现在是「界面出来了，横幅红了」。
- **进度不是日志流。** mock 与真后端都只推累积数组，契约简单；代价是数组随步骤增长被重复发（最多五个步骤，可忽略）。
- **进度盖到开场口播真的出声为止**（ADR-0030 追记里那段「排完到开口还有十几秒」也一起盖）：`opening-line` 最后才打勾。
- **已有日表的开机一个进度都不闪** —— `ensureTodayPlan()` 当天已有日表就直接 return、不发事件，直接进口播界面。
- **不闪一下让人反应不过来**：最短展示 ~0.8s + 完成态停留 ~0.6s + 淡出 ~0.32s。这三档写在 `BootProgress.tsx`
  顶部（不散在样式里）；dark / light 两套都做，文案英文。
- **已知限制**：`advance()`（点队列跳歌）不重新生成口播 —— ADR-0026 的老缝，这一轮没动。