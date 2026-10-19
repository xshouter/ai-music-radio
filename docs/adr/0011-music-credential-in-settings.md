# ADR-0011 · 网易云凭证进 Settings：临时的 URL 留服务端，凭证明文永不回显

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`docs/requirements/ui-player.md`（交互决策 5）、`shared/api-types.ts`、`docs/abstraction-layer.md` 第 5 节、ADR-0005、ADR-0007

## 背景

用户在 3.2 的需求答复里给 `LOGIN` 定了用途：**点开一个凭证弹窗，填 LLM / TTS 的 API key 与网易云 cookie。**

LLM 与 TTS 的 key 已经有位置了（`SettingsView.llm` / `SettingsView.tts`，ADR-0005 定了
「出参与入参分离、key 只回显配没配」）。**但网易云 cookie 一个字段都没有。**

不决策会怎样：

1. `.env.local` 是此刻唯一能放 cookie 的地方 —— 那是**开发期**的办法，而交付形态是一个别人下载后自己填的 exe（阶段 5）。
   别人拿不到 `.env.local`，等于拿不到能播的歌。
2. cookie 会出现在最危险的形状里：`MUSIC_U` 是**账号级凭据**，泄露等于把整个网易云账号交出去。
   它必须和 `apiKey` 受同等对待，而不是塞进一个「未建档」的口袋。
3. 3.1 已经把设置端点写成了 `llm` / `tts` 两块。第三个块（音乐源）没有形状，UI 就没有落点。

## 决策

**一、`SettingsView` 加第三块 `music`，沿用同一套「只回显配没配」模式。**

```ts
music: { provider: string; cookieSet: boolean }     // provider 如 'netease'
```

**二、写入走同一个 `PUT /api/settings`，cookie 是封闭字段。**

```ts
SettingsInput.music?: { provider?: string; cookie?: string }
```

**三、`MUSIC_U` 与 `__csrf` 的值永不进任何响应，永不进日志，永不进错误消息。**

危险字段禁令（第 5 节）从 `apiKey` / `MUSIC_U` / DB 路径，明确扩到「cookie 整条头」。

**四、这个弹窗只有**一个**用途：把凭据交给本机后端。**

它不做「登录」「退出登录」「账号信息」——本机后端把它存进 `data/`（不提交、不随 exe 分发），仅此而已。

**边界**

- 不做 OAuth / 扫码登录：那是另一条链路，v1 只需要用户自己粘一条 cookie。
- 不做多账号切换：单用户单机（ADR-0007）。
- 不管 cookie 的**有效期**：过期后表现为 `MUSIC_NOT_RESOLVABLE`，走既有的降级链与错误码，**不新增错误码**。

## 后果

- **好处**：
  - 交付形态闭环：别人下载 exe → `LOGIN` 填三样东西 → 能播。（这正是「exe 不含凭证」那句话的落点。）
  - cookie 与 apiKey 受同一套禁令保护，不会因为「它不算 key」而被降级对待。
  - 契约面只加一块 `music`，UI 的设置弹窗与将来的 Settings 页共用同一个端点。
- **代价**：
  - `SettingsView` 从两块变三块，`mock` 与将来的 `core/server.ts` 都要跟着长。这是**要还的债**，还债点就是阶段 4 的 `core/server.ts`。
  - cookie 存进本地文件之后，「凭证明文永不回显」这条**只能靠测试钉住**，没有别的机制保证。所以本 PR 加了两条断言：
    PUT 一条真 cookie 之后，响应体里既不许出现它的值，也不许出现 `cookie` 这个字段名。
  - `.env.local` 这条开发期的路**保留**（两个来源合流进 `Store`），意味着「cookie 从哪来」有两个入口。
    取舍：开发时不想开弹窗，这是合理的；但优先级必须写死 —— **`PUT /api/settings` 写的值覆盖 env**，否则会出现「填了不生效」这种最难查的问题。
- **重新打开的条件**：
  - 网易云改成官方支持的授权方式（那时先做需求，再改契约）；
  - 出现第二个用户或第二台机器，需要账号隔离。

## 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 只靠 `.env.local`，不做弹窗 | 交付形态是给别人下载的 exe，`.env.local` 对下载者不存在 |
| 新建一个 `POST /api/credentials` 端点 | 和已有的 `/api/settings` 是同一件事（都是「本地凭据的读写」），两个端点会各有一套回显规则 |
| 把 cookie 存在前端（`localStorage`） | 违反铁律 5；而且 cookie 是账号级凭据，不该出现在 renderer 的存储里 |
| 扫码登录 / OAuth | 为 v1 引入一条完整的授权链路，收益只是「少粘一次字符串」 |
| 在 `SettingsView` 里回显 cookie 的前 6 位「方便用户确认」 | 部分回显也是泄露；确认靠 `cookieSet: boolean` + 一次「已连通」的探测就够了 |
| 为「cookie 过期」新增一个错误码 | 错误码是封闭枚举；过期表现为解析失败，既有 `MUSIC_NOT_RESOLVABLE` 已经覆盖 |

## 落地清单

- [x] `shared/api-types.ts`：`SettingsView.music` / `SettingsInput.music`
- [x] `docs/abstraction-layer.md` 第 5 节：settings 两张表的行 + 危险字段禁令扩写
- [x] `mock/server.mjs`：`settings.music` + PUT 处理（只记配没配）
- [x] `tests/contract/mock.test.mjs`：cookie 明文与字段名双双不回显的断言
- [ ] 未落地：`LOGIN` 弹窗本体（阶段 3.8）