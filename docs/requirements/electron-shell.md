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

- 默认 `616×876` 的 **1.5 倍**（924×1314，`useContentSize`），最小不低于设计画布；
- 界面自己按 `--scale` 等比缩放，窗口怎么拉都不折行（阶段 3 已定）；
- 单实例：第二个进程唤起已有窗口，不再起第二台电台。

## 验证

- `tests/main/bootstrap.test.mjs`：真起一台电台（真 SQLite、真 HTTP、真 UI 目录），从外面打四件事 ——
  UI 同源免令牌、数据面要令牌、凭据只回「已配置」、越界路径 404。
- 手工：`npm run electron:dev` 打开窗口，`%APPDATA%\EdgeRunner\data\edgerunner.sqlite` 被建出来，
  UI 显示 `CONNECTED`（WS 握手成功）。