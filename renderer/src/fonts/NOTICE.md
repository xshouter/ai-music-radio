# 内置字体与许可

这三个字体只内置 **latin 子集**，都在 SIL Open Font License 1.1 下，可以随本项目分发。
为什么内置而不是走 Google Fonts CDN：交付形态是本地 exe，界面不该依赖外网。

## Doto

- 文件：`doto-latin.woff2`
- 许可证：SIL Open Font License 1.1（见 `doto-OFL.txt`）
- 子集：latin（`unicode-range` 见 `fonts.css`）
- 下载地址：https://fonts.gstatic.com/s/doto/v3/t5t6IRMbNJ6TQG7Il_EKPqP9zTnvqouBWho.woff2
- 抽自 Google Fonts 的 CSS API（`family=Doto:wght@400..900`），与 google/fonts 仓库 `ofl/doto/` 同一份字体

## Inter

- 文件：`inter-latin.woff2`
- 许可证：SIL Open Font License 1.1（见 `inter-OFL.txt`）
- 子集：latin（`unicode-range` 见 `fonts.css`）
- 下载地址：https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
- 抽自 Google Fonts 的 CSS API（`family=Inter:wght@100..900`），与 google/fonts 仓库 `ofl/inter/` 同一份字体

## Space Grotesk

- 文件：`space-grotesk-latin.woff2`（可变字体，`font-weight: 300 700`）
- 许可证：SIL Open Font License 1.1（见 `space-grotesk-OFL.txt`）
- 子集：latin（`unicode-range` 见 `fonts.css`）
- 下载地址：https://cdn.jsdelivr.net/npm/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2
- 用途：**小标签专用**。参考源站点的小字用 Space Grotesk（大写 + 宽字距），Doto 只用在 wordmark 与大钟；
  照抄这个分工 —— Doto 是点阵字体，9-10px 下会被抗锯齿糊成虚线，读不清。

## 版权行（来自各自的 OFL.txt）

- Doto：Copyright 2024 The Doto Project Authors (https://github.com/oliverlalan/Doto)
- Inter：Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)
- Space Grotesk：Copyright 2018 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)
