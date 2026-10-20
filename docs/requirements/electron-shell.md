# 需求：Electron 外壳与唯一组装点（`main/`，阶段 5.1）

> 铁律 2 的产出。回答"零件怎么装成一台能双击打开的程序"。
> 契约与边界见 `docs/abstraction-layer.md` 第 2 节；打包方式见 ADR-0021；同源见 ADR-0020。

## 目标

把 4.1–4.6 与 5.0 的零件装成一个**双击就开**的桌面程序：窗口、内核、数据库、UI，全在一个进程树里，
**不含任何凭证**（key / cookie 由使用者在 LOGIN 里填，落在自己的用户数据目录）。

## 三个文件，三种职责

| 文件 | 职责 | 谁可以依赖它 |
|---|---|---|
| `main/bootstrap.ts` | **唯一组装点**：`new DatabaseSync` → `SqliteStore` → `TasteRepo` → `createRadio` → `createRadioServer` → `listen` → `boot()` | **不 import electron** |
| `main/main.ts` | Electron 外壳：单实例、开窗、把窗口指向内核端口、退出时收摊 | import electron |
| `main/preload.ts` | 渲染进程与主进程之间唯一的桥：只递一个一次性令牌 | import electron |

**`bootstrap.ts` 不 import electron** 不是洁癖：它让整台电台能在纯 Node 下被测试
（`tests/main/bootstrap.test.mjs`）。Electron 具体是什么、窗口怎么开，跟"电台能不能起来"是两件事。

## 接线（全部发生在 `bootstrap.ts`）

- **驱动注入**：`new DatabaseSync(<userData>/data/edgerunner.sqlite)`，`as unknown as SqliteDatabase` 交给内核
  （ADR-0014：内核不认具体驱动）。
- **三个目录**：`data/`（库 + 语料 + 口播缓存）、`music/`（本地兜底）、`cache/`（TTS）。
- **时钟**：`{ now: () => new Date() }` —— 只有这里能用真实时间，内核里不许 `new Date()`。
- **env**：`weather → null`、`calendar → []`（v1 没有接入，但不写死在调度器里）。
- **网易云**：`neteaseBaseUrl` 默认 `http://127.0.0.1:3000`，可用 `EDGERUNNER_NETEASE_BASE_URL` 覆盖
  （ADR-0016：加密层在兼容服务里，不在内核里）。
- **端口**：`listen(0, '127.0.0.1')` —— 随机端口、只绑本机（ADR-0007）。

## 令牌怎么进渲染进程

`<audio>` 与初始文档设不了自定义头，所以：

1. 主进程 `randomBytes(24)` 生成一次性令牌，**经 `webPreferences.additionalArguments`** 递给渲染进程；
2. `preload.ts` 从 `process.argv` 里捞出它，写成 `window.__RADIO__`；
3. `renderer/src/api/client.ts` 的 `TOKEN` 兜底读 `window.__RADIO__?.token`。

**渲染进程的业务代码一行没改** —— 只多了一条"令牌从哪来"的兜底。UI 仍然只跟"自己所在的源"说话。

## 窗口

- 默认就是设计画布本身 `616×876`（`useContentSize`、`ZOOM = 1`）—— 窗口就是那张卡片，不是它的 1.5 倍；
- **可缩放**：锁 616:876 的宽高比，能从 **0.5 倍画布（308×438，`MIN_ZOOM`）** 一直放大到屏幕放不下；
- 界面自己按 `--scale` 等比缩放，窗口怎么拉都不折行（阶段 3 已定）；
- **无边框 + 透明**，所以页面不许给 `html` / `body` 铺底色（`renderer/index.html`）：铺了，卡片圆角外面那圈就是
  不透明的直角。圆角、底色、描边都由 `.shell` 自己画；
- 单实例：第二个进程唤起已有窗口，不再起第二台电台。

## 5.6 落地记录（PR #42）

用户点名的两件事，加上修它们时暴露的第三件。规格里只有上面「最小不低于设计画布」这一条被改写，其余不动。

| # | 要求 | 根因 | 改法 |
|---|---|---|---|
| 1 | 窗口要能**等比缩小** | `minWidth/minHeight` 就钉在画布上（616×876），而默认尺寸**也是** 616×876 —— 窗口一出生就站在自己的最小值上 | `MIN_ZOOM = 0.5`，下限改 308×438 |
| 2 | 悬浮卡片要**有圆角** | `renderer/index.html` 里 `html { background: #111111 }` 把透明窗口的圆角填成了不透明直角 | 删掉那句，底色只由 `.shell` 画 |
| 3 | 0.5 倍下卡片**贴右下角**（放开缩小后才露头） | `.viewport` 的 grid `place-items: center` 对**大于容器**的项会贴起始边，`transform-origin: center center` 又按布局盒中心缩 | 改绝对定位 + 半个画布的负边距居中 |

查证过程（CDP 真窗口像素、四档 `--scale`、Win32 `SetWindowPos` 探最小值）记在
`docs/journal/2026-10-20.md` 第 25 条。

## 验证

- `tests/main/bootstrap.test.mjs`：真起一台电台（真 SQLite、真 HTTP、真 UI 目录），从外面打四件事 ——
  UI 同源免令牌、数据面要令牌、凭据只回「已配置」、越界路径 404。
- 手工：`npm run electron:dev` 打开窗口，`%APPDATA%\EdgeRunner\data\edgerunner.sqlite` 被建出来，
  UI 显示 `CONNECTED`（WS 握手成功）。