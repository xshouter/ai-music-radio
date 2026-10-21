# 需求（草稿 · 待确认）· 打开即用：内核自己把音乐源拉起来

- **状态**：**待确认** —— 第 4 节的假设不反对就按它做，然后冻结、写代码（铁律 2）
- **来源**：用户 2026-10-20 的口头要求 1（「exe 启动时就启动完整服务，用户只需要填 apikey 和网易云 cookie」）
- **关联**：ADR-0016（本条要动它）、ADR-0023、`main/bootstrap.ts:14`、`main/main.ts`、
  `docs/journal/2026-10-20.md` 第 36 条决策 5 —— 上一轮刚决定「**不**在内核里拉起兼容服务」，
  本条是它的反面，所以要新 ADR，不是改注释

## 1. 现状（事实）

- `main/bootstrap.ts:14`：`DEFAULT_NETEASE_BASE_URL = 'http://127.0.0.1:3000'`，可被 `EDGERUNNER_NETEASE_BASE_URL` 覆盖。
- 兼容服务 `NeteaseCloudMusicApi` **不在发布物里**：要用户自己 `npx NeteaseCloudMusicApi` 起。
- 它不在时的后果（第 36 条实测过）：大脑拿不到任何合法 id → `emit_show` 全驳回 →
  **没有音乐、也没有口播**，界面上只留一条 `MUSIC_SOURCE_UNREACHABLE` 横幅。
  「装完打开没声音」最省事的一种解释就是它。

## 2. 要什么

1. 双击 exe → 电台自己把音乐源拉起来，用户不碰第二个进程。
2. 用户只填两样：一个 LLM apikey、一份网易云 cookie。（TTS 是离线 piper，不用填。）
3. 拉不起来时不崩：退到本地源，并把原因说到界面上。

## 3. 设计

- **内置**：`NeteaseCloudMusicApi@4.32.0`（含依赖 ≈27 MB）打进 `extraResources/netease`。
- **拉起**（`main/` 新增一个「代管启动」的壳，`core/` 一个字不动）：
  1. 先向操作系统要一个**空闲端口**（`listen(0)` 再关）—— **不抢 3000**，天然不和别人的服务打架；
  2. `spawn(process.execPath, ['app.js'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT }, cwd })`
     —— 用 Electron 自带的 node，用户**不用装 Node**；
  3. 轮询 `/` 到 200 或超时，拿到 `http://127.0.0.1:<port>` 交给 `startRadio`；
  4. 退出时连进程树一起杀（Windows 上 `child.kill()` 杀不掉孙子进程）。
- **后门留着**：`EDGERUNNER_NETEASE_BASE_URL` 给了值就用外部的、**不** spawn —— 开发 / 测试靠它。
- `core/` 仍只当 HTTP 客户端（ADR-0016 的正文不变，只改「谁负责把它拉起来」这一句）。

## 4. 假设（不反对就按这个做）

| # | 假设 | 理由 |
|---|---|---|
| 1 | 拉不起来 = 挂横幅 + 降级到本地，**不**弹窗、**不**自动重启 | 既有降级链已经能演到这一步；多一层重启只会让「起不来」更难查 |
| 2 | 发布物体积 ≈169 MB → ≈196 MB，接受 | 这是「打开即用」的标价 |
| 3 | 不为终端用户做「我自己有服务」的开关 | 后门是给开发的；多一个开关 = 多一条用户要理解的错误路径 |
| 4 | 服务随电台生死 | 电台不在的时候没人要它 |

## 5. 验收

- 冷机器只填 apikey + cookie → 有音乐、有口播。
- 3000 被别的程序占着 → 照常出声（因为它不用 3000）。
- 关掉电台 → 任务管理器里不留 `app.js` 孤儿进程。
- 把 `resources/netease` 删掉再启动 → 不崩，退到本地源 + 横幅。


## 6. 打包落点的追记（2026-10-21 · 实测发现的坑）

开头这一版**没有真的进包**：`v0.1.5` 发出去的便携版里 `resources/netease` 只有 `package.json` 与
`package-lock.json`，没起过服务，界面表现为 `0 TRACKS`。原因是 electron-builder 的 extraResources
会**无条件丢掉源目录顶层的 `node_modules`**（`app-builder-lib/out/util/filter.js`：`relative === 'node_modules'`
直接 `return false`，早于用户 `filter` 生效），写 filter 也救不回来。

落地的形状因此是**两条映射**：`vendor/netease → netease`，外加
`vendor/netease/node_modules → netease/node_modules`；`core/` 期望的
`<dir>/node_modules/NeteaseCloudMusicApi/app.js` 一个字不改。并加一条 CI 落点自检
（`.github/workflows/release.yml`），因为这一路的失败是静默的 —— 包能出、CI 全绿、界面正常，只是没有音乐。
完整推理见 ADR-0034，实测过程见 `docs/journal/2026-10-21.md` 第 48 条。

第 5 节那条验收「把 `resources/netease` 删掉再启动 → 不崩」**依然成立**，而且现在多一条同族的：
**删掉之后不会静默指到 3000 上假装有源** —— 这个坑记在 roadmap 里，等单独一轮收。
