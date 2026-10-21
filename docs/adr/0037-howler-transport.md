# ADR-0037 · 播放引擎交给 Howler，运输条真的能点能拖

- **状态**：已接受
- **日期**：2026-10-21
- **关联**：`renderer/src/hooks/useRadio.ts`、`renderer/src/components/Transport.tsx`、
  `renderer/src/styles.css`、`renderer/src/App.tsx`、`renderer/package.json`；
  ADR-0007、ADR-0010、ADR-0029
- **需求**：`docs/requirements/voice-models-player.md`

## 背景

用户的原话是「你手搓的播放器不太好用，你去看看有没有开源好用的播放器可以嵌入进来」。

先把「不太好用」拆开，因为它其实是两件事：

1. **一个能用的引擎。** 原来的播放是一条手搓的 `<audio>` 管道：自己听 `timeupdate` 算进度、
   换源要重挂监听、音乐与口播两条流各管一套。这些都是 Howler 这一类库已经解决过的问题。
2. **一个能点的进度条。** 运输条上那条进度是 **3px 高的 `<div>`**：不能点、不能拖。
   这在播放器上是硬伤 —— 想跳到副歌，唯一的办法是点快进。

「嵌一个现成的播放器进来」这条**不能照字面做**：这一档的硬要求是视觉 **1:1 复刻**参考源
（口播界面那张 616x876 的卡片就是基准尺寸）。嵌一个别人的播放器皮肤，当场就把这条要求破坏了。
所以要换的是**引擎**与**可用性**，不是皮肤。

## 决策

**① 音频引擎换成 Howler（MIT；`howler` + `@types/howler`，只进 renderer 这个 workspace）。**

音乐与口播各是一条 `Howl` 管道，换歌 / 换口播是 `unload()` + `new Howl(...)`。
`html5: true` 是**必须的**：`/api/audio/:songId` 是 302 到远端 CDN，那一家不给 CORS 头，
Web Audio 那条路取不到音频 —— 而 HTML5 Audio 那条路不受同源策略约束。

**② 进度不再靠 `timeupdate`，自己 100ms 读一次。**

Howler 不发 `timeupdate`。一个 100ms 的 `setInterval` 读 `howl.seek()` 足够 ——
运输条是 3px，肉眼分辨不出 100ms。定时器只在「音乐在放 或 口播在放」时存在。

**③ 运输条变成一个真的按钮：点与拖都跳到那一刻。**

`.track` 从 `<div>` 换成 `<button>`，用 Pointer Events（`setPointerCapture`）实现抓取 - 拖动 - 释放。
命中区用一个伪元素上下各撑 9px —— **视觉一点不变，可点区域从 3px 变成 21px**。
`durationMs <= 0`（还没 load 出来）时按钮 disabled。

**④ 播放权不变。**

拖动只调 `radio.seek(ms)`，它做的事就是 `howl.seek(seconds)` —— **没有第二个真相**。
播放权威仍在 `useRadio` 那一处（ADR-0010 / ADR-0029），组件只是它的视图。
口播的 REPLAY 是同一个 src，靠一个 tick 驱动 effect 让 `Howl` 真的重建一遍。

## 后果

- **好处**：进度条跟手；换歌 / 换口播的管道由库兜住（`play` / `pause` / `end` / `loaderror`
  都是库事件，不用自己接线）；口播的 REPLAY 不再需要手写「同一个 src 重播」那套特例。
- **代价**：多一个运行时依赖（压缩后约 30KB，只进渲染进程）。它替换掉的是一条手搓的 `<audio>` 管道 ——
  那条管道出事时是我们自己查，现在要跟着库的事件模型走。
- **一个已知限制（原来的行为，没变）**：`loaderror` 时直接跳下一首，不做重试。
  试听片段被拒、解析不出来都属于这一类；停在一首放不出来的歌上，比跳过它更糟。
- **重新打开的条件**：出现「要做跨歌的淡入淡出 / 交叉衔接」「要波形可视化（真的从 PCM 来）」
  —— 那说明需要的是 Web Audio 的 `AudioContext` 而不是 `html5: true`，而它要求那个 CDN 给 CORS 头。

## 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 嵌一个现成的播放器组件（皮肤一起进来） | 视觉 1:1 复刻是这一档的硬要求；别人的皮肤会当场破坏它 |
| 继续手搓 `<audio>`，只把进度条做成可点的 | 手搓的那条管道正是「不太好用」的一半来源（自己管换源、自己接监听）。库就是为这件事存在的 |
| Howler 走默认的 Web Audio 那条路（不带 `html5`） | 远端 CDN 不给 CORS 头，取不到音频。`html5: true` 走的是不受同源约束的那条 |
| `requestAnimationFrame` 刷进度 | 60fps 重渲染一条 3px 的条，换不来任何肉眼可见的差别。100ms 够 |
| 拖动时本地先乐观改位置 | 我们拖的就是**真的播放位置**（`howl.seek`），不需要第二份乐观状态 —— 有了它反而要处理「松手回跳」 |
| 引一个 React 播放器封装（如 react-h5-audio-player） | 它自带整套 UI 与样式，等于把上面那条「皮肤不能换」再犯一次；我们要的只是引擎 |