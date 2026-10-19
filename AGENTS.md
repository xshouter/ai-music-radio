# 工程铁律（不可违反）

本项目叫 **EdgeRunner**：本地常驻的个人 AI 音乐电台。以下五条是**铁律**——违反即回滚，不走「下次注意」。

1. **代码用 git 管理** —— 分支 → PR → 自查 → 合并；永远不直推 `main`。
2. **需求必须 grill** —— 没被追问到没有隐含假设的需求，不许写代码；产出落 `docs/requirements/<feature>.md`。
3. **先前端再后端** —— 冻结契约 → mock → UI → 换真后端；后端不许插队。
4. **好看优先，自己拍板** —— 视觉不明确时自己定（可用 skill / 搜索 / 线上真源），不要停下等确认；复刻参考源的部分仍要 1:1 对齐。
5. **前端永远不碰数据库** —— `renderer/` 只能通过 HTTP/WS 与后端说话。

落地细则、以及每条「被违反的样子」，见 `docs/engineering-rules.md`。

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/` in this repo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: a root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.