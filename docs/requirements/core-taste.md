# 需求：语料仓库（`core/taste.ts`，阶段 4.6）

> 铁律 2 的产出。回答"人的口味怎么进系统、系统的结论又存在哪"。
> `RadioOptions.taste` 是构造参数（`core/radio.ts`），4.5 之前**没有任何实现** —— 本文件补上它。

## 目标

给内核一个真实的 `TasteRepo`：`boot()` 时能读到"这个人喜欢什么"，♡ 点下去时能把这次动作
记成一笔"学到的"。它是 `Profile` 界面的数据来源，也是大脑每次 `think()` 的上下文之一。

## 两条纪律：语料在磁盘、结论在库（ADR-0004）

- **人写的语料 = 磁盘上的 md 文件**。目录里每一个 `.md` 就是一份语料，文件名就是它的身份。
- **系统的结论 = 库里的一行**（`store.appendTasteUpdate`）。`recent` 从这里读。
- **两边永不互相写**：`appendLearned()` 只落库，**绝不回写 md**。md 是人手写的，系统碰它就是把人的地盘搞乱。

## `read()` 的一半一半

返回 `TasteDoc`（`genres` + `corpus` + `recent`）：

- `corpus`：扫目录里的 `.md`，**按文件名 `localeCompare` 排序**（顺序稳定，UI 刷新才不会换位）、
  去两端空白、空文件剔除、最多 12 份、每份截 2000 字。
- `genres`：从 `genres.txt` 读（逗号分隔、去重、去空）。**曲风胶囊是数据不是装饰**（ADR-0010）——
  它写在自己的小文件里，不写死在代码里；单独一个 `.txt` 而不是塞进某份 md，否则那行声明会连着语料原文一起显示。
- `recent`：`store.recentTasteUpdates(limit)`，`limit` 默认 20。

**目录不存在 = 还没有语料，不是错误**（`readdirSync` 抛错就当空目录）。冷启动不炸。

## `appendLearned()` 只写库

`♡` 是**人的动作**（`feedback({action:'like'|'unlike'})`），记成一条结构化的"学到的"：
`Kept <歌名> — <歌手>.` / `Dropped <歌名> — <歌手>.`，带 `evidence: {songId, action}`。

- 时间戳用**注入的 `clock`**，不用 `Date.now()`（可测）。
- 在 `radio.feedback()` 里 `.catch(() => {})`：**学不会不许把喜欢本身弄失败** —— 喜欢已经落库了，
  这条只是账外的一笔。

## 测试（`tests/core/taste.test.mjs`，3 条）

- 语料 = 目录里的每一个 `.md`，按文件名排序；没有目录就是没有语料。
- 曲风胶囊是数据：写在 `genres.txt` 里，去重、去空。
- `appendLearned` 只写库：语料是人的地盘，系统永不回写（ADR-0004）。

`tests/core/radio.test.mjs` 的"播放事实"那条加了断言：♡ / 取消 ♡ 各落一条学到的。