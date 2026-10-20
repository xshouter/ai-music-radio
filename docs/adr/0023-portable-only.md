# ADR-0023 · v1 只发 portable exe，不发安装包

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`electron-builder.yml`、`.github/workflows/release.yml`、`docs/requirements/electron-shell.md`

## 背景

交付物要满足"下载 → 双击 → 填自己的 key 就能用"。作品集的读者不会为了看一个项目去走一遍安装向导，更不想在系统里留下卸载项。electron-builder 默认给的是 NSIS 安装包（`-setup.exe`）：要管理员权限、写注册表、装开始菜单。

## 决策

`electron-builder.yml` **只留 `portable` target**，产物是单个 `-portable.exe`；release 工作流只上传它，job 名改成 `windows-portable`。

## 后果

- **好处**：双击即用 —— 无管理员权限、无注册表、无残留；一个文件就是一个交付物。
- **好处**：用户数据本来就在 `%APPDATA%\EdgeRunner`（ADR-0014 的库路径），不依赖安装位置，换 exe 不丢数据。
- **代价**：没有开始菜单 / 桌面快捷方式，没有卸载器；每次启动要解包到临时目录，冷启动比装好的版本慢一点。
- **重新打开的条件**：真要做"装完常驻"的形态时再加回 `nsis` —— 但要先把卸载与升级路径想清楚，再写一份 ADR。