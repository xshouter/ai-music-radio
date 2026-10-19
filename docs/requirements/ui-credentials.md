# 需求：UI 复刻 · 凭证弹窗（阶段 3.9）

> 铁律 2 的产物。状态：**已定案**。
> **这一轮 grill 与用户脱钩**：用户已授权全托管（「不用停下来问我，你一直往下做」），所以需求由 agent 自己收敛，
> 并把每条假设**显式写下来** —— 铁律 2 的本意是「不留隐含假设」，不是「必须找人问」。
> 上游依据：ADR-0005（出参与入参分离）、ADR-0011（网易云凭证进 settings、明文永不回显）、
> `docs/requirements/ui-player.md` 交互决策 5（`LOGIN` 的用途）、`shared/api-types.ts` 的 `SettingsView` / `SettingsInput`。

## 目标

`LOGIN` 从死按钮变成**凭证弹窗**：在这里填「大脑（LLM）/ 嗓子（TTS）/ 音乐源（网易云 cookie）」三块凭证。
契约在 3.4 已经冻结（ADR-0011），所以这一版**只做 UI 与接线**，`shared/` 一行不动。

## 决策（已定）

| # | 问题 | 结论 | 理由 |
|---|---|---|---|
| 1 | 弹窗长什么样 | 复用 `.overlay` + 深色点阵卡片（与 DJ 详情同一套视觉） | 铁律 4 已改成「自己拍板」；同源视觉最省事也最像 |
| 2 | 哪些字段能回显 | 只有 `baseUrl` / `model` / `protocol` / `provider` / `voice` 回显；**key 与 cookie 永远空**，只显示 `SET` 徽标 | ADR-0005 / ADR-0011 / 危险字段禁令 |
| 3 | 留空提交等于什么 | **等于「不改」**：空字符串不进 payload（给 `undefined`），后端不会把已存的值清掉 | 用户常常只想改一项 |
| 4 | protocol 怎么填 | `OPENAI` / `ANTHROPIC` 二选一的分段控件（复用 `.seg`） | 契约里 `protocol` 是封闭枚举；mock 忽略非法值 |
| 5 | 保存反馈 | 底部一行状态：`STORED LOCALLY` / `SAVING` / `SAVED` / 错误码 | 错误码是封闭枚举，UI 只认 code（抽象层第 5 节） |
| 6 | 怎么关 | `✕` / `CANCEL` / 点空白 / `Esc` | 与 DJ 详情弹层一致 |

## 假设（显式写下来）

- 不做「测试连接」按钮：v1 只在真调用时暴露错误（有统一错误横幅）。
- cookie 用多行 `textarea`（整条 cookie 头很长），不做字段级拆分。
- 不做「清除已存凭证」：契约里没有 delete 语义，需要时再开 ADR。

## 验收标准

- [x] `LOGIN` 打开弹窗；`✕` / `CANCEL` / 点空白 / `Esc` 都能关
- [x] 打开时打 `GET /api/settings`，非明文字段填好；key / cookie 留空 + `SET` 徽标表示已配置
- [x] `SAVE` 走 `PUT /api/settings`；**留空的字段不出现在 payload 里**
- [x] 保存成功后清空三个明文输入，状态变 `SAVED`；失败显示错误码
- [x] DARK / LIGHT 两个主题都正常
- [x] 边界检查通过（`renderer/` 里不许出现凭据特征串 —— 这条**真的抓到过一次**，见 journal）

## 已知不做

- 不做凭证的加密落盘（阶段 4 由 `Store` 决定怎么存；v1 明文只在本机 settings 里）。
- 不做「换 provider 后字段联动」（契约里的三块是扁平的固定字段）。
