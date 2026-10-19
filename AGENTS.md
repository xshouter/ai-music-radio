# ai-music-radio

复刻 mmguo 的 Claudio：一个本地常驻、自己排节目、会用英文开口讲话的个人 AI 电台。
目标载体是公开 GitHub 仓库 + 可下载 exe，受众是面试官。

## 铁律（不可违反）

1. **代码用 git 管理**：所有改动走「分支 → PR → 自查 → 合并」，不直接推 `main`。每个 PR 必须能被单独读懂、单独回滚。
2. **需求必须 grill**：任何需求在动手前先被逐轮追问，直到没有隐含假设。没被 grill 过的需求不许写代码。
3. **先前端再后端**：先冻结 API 契约、先把界面做出来（对着 mock 跑通），再实现后端。不允许"后端写完再说界面"。
4. **样式不明确就要截图**：任何拿不准的视觉细节，向用户要参考截图，不要自己猜。
5. **前端永远不碰数据库**：渲染进程只能通过后端 HTTP/WS API 拿数据。禁止 import 任何数据库、存储或 `node:fs` 模块。

细则见 `docs/engineering-rules.md`，系统抽象层的"缝"见 `docs/abstraction-layer.md`。

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/` in this repo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: a root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.