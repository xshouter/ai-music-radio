# ADR-0014 · `core/` 只认结构化 SQLite 驱动，不认具体库

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`docs/abstraction-layer.md` 第 3.5 节、第 2 节依赖表；ADR-0007（只做 PC 单端）

## 背景

抽象层第 3.5 节原话是「实现：`core/state/sqlite-store.ts`（better-sqlite3）」。落地阶段 4.1 时，这句话有三个问题：

1. **better-sqlite3 是原生模块**。它在 Electron 里必须 `electron-rebuild` 重编 ABI，交叉编译进 Windows exe 尤其脆。
   本项目的分发模型是「别人下载 exe → 填自己的 key」（ADR-0007），一个装不上的原生依赖会把这条路直接堵死。
2. **Node 自带 `node:sqlite`**（22.5 起实验、24 起稳定）。对一个明确只要 SQLite 的项目，
   它正好是零依赖的那一档。
3. 更要紧的是**谁拥有依赖**：把 `better-sqlite3`（或 `node:sqlite`）的 import 写进 `core/`，
   等于让内核知道"我用的是哪个库"，那么换库、或在测试里换内存驱动，都要改内核。

## 决策

`core/` **不认识任何具体驱动**。`core/state/sqlite-store.ts` 只声明它需要的最小结构接口：

```ts
export interface SqlStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown;
}
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}
```

驱动由**唯一组装点** `main/bootstrap.ts` 注入 —— 它 `new DatabaseSync(path)` 后交给 `new SqliteStore(db, clock)`。
这两个接口刻意做成「`node:sqlite` 天然满足」的形状，注入点不需要任何 `as` 或适配器。

选择 **`node:sqlite`** 作为生产驱动（零依赖、无原生构建），`MemoryStore` 作为测试与调度器测试的驱动替代。

配套两条：
- **迁移 SQL 写在 TS 里**（`core/state/migrations/0001_init.ts`）而不是 `.sql` 文件：
  打包成 exe 时 `core/` 会被打成单文件，运行期没有 `migrations/*.sql` 可读。目录形状不变。
- **CI 的 Node 从 22 提到 24**：`node:sqlite` 在 22 上要 `--experimental-sqlite`，本地却不用 ——
  「CI 绿本地红」这类分叉的根子就在这里。

## 后果

- **好处**：`core/` 可测（内存驱动）、可换库（换驱动不动内核）、可打包（无原生模块）。
- **代价**：`SqliteDatabase` 是**手写的**最小子集，`node:sqlite` 将来长出的新能力 core 看不到 —— 需要时显式扩这个接口。
- **新的约束**：`core/tsconfig.json` 必须带上 `types: ["node"]`，而 `shared/tsconfig.json` 的 `types: []` 不能被污染 ——
  两份 tsconfig 分开正是为此（`shared/` 是跨进程的类型面，`core/` 是运行时）。
- **重新打开的条件**：出现必须用 better-sqlite3 能力的场景（例如自定义 vtab / 扩展函数），
  或 `node:sqlite` 在目标 Electron 版本上不可用。

## 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 直接用 better-sqlite3 | 原生模块，Electron ABI 重编 + exe 分发风险，换不来本项目需要的东西 |
| 在 `core/` 里 `import { DatabaseSync } from 'node:sqlite'` | 内核就绑死了一个库；测试要跑内存时还得为它造一个假对象，反而更重 |
| 把 `Store` 拆成 `Repository` 接口再实现（多一层） | 层级已经够用：`Store` 是端口，`SqliteStore` 是它的实现。再包一层只是给"以后可能换 ORM"留门 |
| 迁移用 `.sql` 文件 + 运行期读目录 | 单文件打包后读不到；为了"SQL 好看"换一个运行期故障不值得 |