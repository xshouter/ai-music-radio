# 架构图（EdgeRunner）

这张图回答一件事：**这台电台是由什么拼起来的、字节从哪走到哪。**

| 文件 | 是什么 |
|---|---|
| `edgerunner.png` | 静态图（根 `README.md` 里嵌的就是它） |
| `candidate.json` | 图的**源**：12 个组件、13 条关系、4 张要点卡；**每个组件都带 `sources`**（仓库相对路径 + 行号） |

可交互的那一版（动效、搜索、任意两个节点之间怎么走的路径追踪）是约 830 KB 的生成物，**不进仓库**；
本地一条命令就有：

```bash
# ARCHIFY = 本机 archify skill 的目录
node "$ARCHIFY/bin/archify.mjs" render architecture docs/architecture/candidate.json .archify/edgerunner.html \
  --quality showcase --repo-root .
```

生成与校验（含真实浏览器门）走的是同一条命令的 `finalize` 版本 —— 它会顺带**核对每一处 `sources` 行号**。

## 画到哪一层

**运行时的组件与它们的出网关系，不是模块树。**

- 归并过的：`plan` / `taste` / `server` 三个编排角色都收在 `Radio 内核` 与 `本地服务` 两个节点里；
  `core/providers/` 只画**三条真正出网的路**（LLM / 音乐 / 嗓子）。
- 刻意省略的：`core/` 的文件级依赖、端口的 interface 签名（那些在 `docs/abstraction-layer.md`）、
  错误码与重试语义（在 `docs/adr/0027`）。被省略的事实写在图下的要点卡里，不是从结论里消失。
- 边界只框**进程内**的东西：`你` / `LLM API` / `网易云音乐` 三个外部角色在框外；
  `piper.exe` 与内置网易云服务虽然是 spawn 出来的独立进程，却在框内 —— 因为「双击 exe 就能用」这个事实由它们承担。

## 什么时候该重画

改了**组件边界**（新增一个源、新增一条出网的路、换了存储）就该重画；
改某个函数内部**不该**动它 —— 图上的行号会漂，但结论不变。
