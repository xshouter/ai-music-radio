# ADR-0021 · 主进程用 esbuild 打成单文件 CJS

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`main/`、`tools/build-electron.mjs`、`docs/adr/0014-core-driver-injection.md`、`docs/requirements/electron-shell.md`

## 背景

`main/main.ts` 要 `import` 内核（`core/radio.ts`、`core/server.ts`……），而内核里的相对导入是
**带后缀的**：`import { createRadio } from '../core/radio.ts'`（`tsconfig` 开了 `allowImportingTsExtensions`，
契约 `.ts` 也只是被 typecheck、不产出）。Node 与 Electron 都不认这种导入，直接跑 `.ts` 是跑不起来的。

三条路：

1. 把 `core/**` 里的 `import` 全改成无后缀 → 要动 19 个文件，还改坏了"契约要被编译"这条既定的写法；
2. 用 `tsc` 产出 ESM，再让 Electron 加载 → 多一层构建产物目录、`shared/` 的 `type-only` 边界要在产物里再验一遍；
3. 用 esbuild 把 `main/` + `core/` 打成本进程的**一个 CJS 文件**。

## 决策

**选 3。** `tools/build-electron.mjs` 用 esbuild 把 `main/main.ts` 与 `main/preload.ts` 分别打成
`electron/main.cjs` 与 `electron/preload.cjs`（`platform: node`、`format: cjs`、`electron` 保持 external）。

esbuild 是按**字面路径**解析的，所以 `'../core/radio.ts'` 天然可解析 —— 不需要任何插件、不需要改内核一行。

三条边界：

- **`electron/` 是产物目录**，进 `.gitignore`；仓库里只有源（`main/*.ts`）与构建脚本。
- **`electron` 保持 external**：运行时的 Electron 由外壳提供，不打包进来（体积与版本一致性都靠这条）。
- **`main/` 是唯一能 `import electron` 的地方**（抽象层第 2 节的依赖表）—— 打包不改变这条。

## 后果

- **好处**：内核一行不改；构建一步（`npm run electron:build`）；产物可读（`electron/main.cjs` 单文件）。
- **好处**：`main/bootstrap.ts` **不 import electron** —— 于是它能在纯 Node 下被测试
  （`tests/main/bootstrap.test.mjs` 真起一台电台，只从外面打它）。这条红利是"唯一组装点"给的。
- **代价**：产物里有 esbuild 的包装代码，调试时行号对不上源（没开 sourcemap —— v1 不做，见下）。
- **重新打开的条件**：需要打包后逐行调试主进程时，加 `sourcemap: 'inline'`，先写 ADR 再动。