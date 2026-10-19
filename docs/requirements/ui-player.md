# 需求：UI 复刻 · Player（阶段 3.1）

> 铁律 2 的产物。状态：**已定案**（grill 第 1 轮已收敛，记录见文末）。
> 上游依据：`docs/abstraction-layer.md` 第 5 / 6 节、`docs/requirements/contracts-and-mock.md`、`docs/references.md`、ADR-0007。

## 目标

把电台做成「打开就能看」的界面：**宽窗**是「点阵大钟 + 队列 + 口播流水」，**窄窗**是一张卡片。
界面只跟 mock 说话（HTTP + WS），一行都不碰数据库（铁律 5）。
这是本项目最重要的一个 PR——项目有没有 taste，由它决定。

## 参考观察（事实）

- 抽帧：`docs/reference/frame-0XX.jpg`（本地对照用，**不进仓库**）
- 公开站点 <https://mmguo.dev/claudio-fm/> 的 `branding` 抓取（2026-10-20）：

| token | 值 |
|---|---|
| 强调色（薄荷绿） | `#29FFB8` |
| 底 | `#111111` |
| 正文 | `#DBDBDB` |
| 深绿（次要面） | `#0F3A2A` |
| 按钮面 / 其文字 | `#0A0A10` / `#ACACAC` |
| 正文字体 | Inter |
| 标题字体 | Space Grotesk（站点的 fontStack 实际回退到 Inter） |
| 圆角 / 间距基数 | 28px / 12 |

从抽帧另得到的（视频有压缩，只作对照；实现时以 branding 值优先）：
面板 `#0c100c` / `#101014`，正文近白 `#f7f8fe`；
窄窗卡片暖白 `#f8f8f8` + 深色头部 `#081010`。

**布局（frame-014，宽窗）**

- 顶部：左上点阵 wordmark；右上 `DARK` / `LIGHT` 切换（参考里还有个 `LOGIN`——我们不复刻，无账号体系）
- 主体：巨大的点阵数字钟 + 星期 + 日期 + 绿点 `ON AIR`（降级时旁边出现 `DEGRADED`）
- 运输条：封面缩略 + `曲名 — 歌手` + `NOW PLAYING` + 上一首 / 播放 / 下一首 / 随机 + `HIDE` + `VOL.` 滑杆
- 进度条：两端是 `已播 / 总长`
- `QUEUE — N TRACKS`：当前行带绿色左边条与 `PLAYING...`；其余行 `歌名 — 歌手`
- 口播流水：`Claudio · 0:00` + 正文，右上角 `LIVE`
- 底部输入：`Say something to the DJ...` + 麦克风 + 发送
- 底栏：左 `EDGERUNNER FM`，右绿点 `CONNECTED`

**布局（frame-001 / 021-026，窄窗）**

竖屏卡片浮在渐变底上；深色头部（头像 + wordmark + 绿点 + `Speaking...`）+ 波形；
暖白唱片区（两行大标题 + 歌手 + 暂停 + 进度 + `已播 / 总长`）；口播流水；底部运输条。

## 已定决策

- **技术栈**：Vite + React + TypeScript，产物 `renderer/dist`（阶段 5 由 Electron `loadFile` 加载）——grill Q1
- **主题**：DARK 与 LIGHT **都做**，同一套 CSS 变量换值；参考默认 DARK——grill Q2
- **点阵字体**：用授权干净的开源点阵字体，**在仓库里记清许可与来源**——grill Q3
- 口播与 UI 文案**英文**（`docs/references.md`）
- 只做 **PC 单端**：无账号（不复刻 `LOGIN`）、无输出设备选择（ADR-0007）
- 界面唯一真相是 `shared/api-types.ts`；UI 只认 HTTP + WS（铁律 5）
- base URL 只从一处注入，切真后端只改这一个值（ADR-0006）

## 写下来的假设

1. 「两态」= **同一个页面的响应式**，断点约 720px；窄窗态就是参考的手机卡片形态（PC 上把窗口拉窄）。
2. 聊天插话（`POST /api/chat`）在 3.1 就做——否则 `say` 逐句浮现没有触发方式，根本验证不了。
3. 音频真的用 `<audio>` 播；mock 的静音 WAV 足够验证进度、波形与 Range。
4. 歌词用 `GET /api/lyric/:songId` 的 LRC 自己解析，不引第三方 LRC 库。
5. `HIDE` 保留：我们有同一个口播面板要折叠。
6. 3.1 只做 Player；Profile / Settings 留 3.2（见 `docs/roadmap.md`）。
7. 麦克风按钮（参考里有）在 3.1 **只做外观、不接语音输入**——v1 没有语音识别这条链路。

## 阻塞项（按铁律 4 要截图）

参考视频与站点 branding 里**只有 DARK 的完整样子**，LIGHT 没有可读的参考。
已向作者要 LIGHT 态截图。拿到之前：**DARK 先行**，LIGHT 只在 token 层留位——
拿到截图后是纯换值、不动布局（这正是把 token 抽出来的理由）。
另：站点 branding 只给到色板与字体族，**点阵字体的具体字体名未暴露**（wordmark 与钟可能是图形），
所以点阵字体按「挑一款授权干净、网格最接近的」来定，并在实现 PR 里写下选项与理由。

## 验收标准

- [ ] 对着 `npm run mock` 跑通：`now` / `queue` / `plan` / `say` 逐句浮现 / 歌词逐行高亮 / 聊天插话
- [ ] 全部降级与错误态都能显示：`DEGRADED` 徽标、六个错误码各自的样子、未配置 key 的「还差什么」
- [ ] 宽窗与窄窗两态都能用（拉伸窗口即可切）
- [ ] DARK 与 LIGHT 都能显示（LIGHT 待截图确认后定稿）
- [ ] `renderer/` 不 import 数据库 / `node:*` / `core/**` / `main/**`（CI 边界检查）
- [ ] `npm run build` 产出 `renderer/dist`
- [ ] 切真后端时 UI 一行不改（只换 base URL）

## 已知与参考的不同（不是疏漏）

| 维度 | 参考 | 本项目 | 为什么 |
|---|---|---|---|
| 账号 | 右上 `LOGIN` | 不复刻 | 单用户单机，无账号体系（ADR-0007） |
| 输出设备 | UPnP 选择 | 不复刻 | 声音只从本机出（ADR-0007） |
| 底栏标识 | `CLAUDIO FM` | `EDGERUNNER FM` | 项目名 |
| 语音输入 | 麦克风 + 语音 | 麦克风只作外观 | v1 没有语音识别链路（假设 7） |

## grill 记录（第 1 轮）

| # | 问题 | 结论 |
|---|---|---|
| 1 | `renderer/` 用 Vite + React + TS？ | **是** |
| 2 | 只做 DARK？ | **不是**：DARK 与 LIGHT 都做 |
| 3 | 点阵字体用开源字体？ | **是** |

同一轮里问过、但由我定掉并写进「假设」的：两态是同一个页面的响应式、聊天插话进 3.1、音频真播、
歌词自解析、`HIDE` 保留、3.1 不碰 Profile / Settings。