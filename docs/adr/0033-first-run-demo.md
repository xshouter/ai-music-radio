# ADR-0033 · 首次体验：随包的一首歌 + 一段冻结的口播

- **状态**：已接受
- **日期**：2026-10-21
- **关联**：`core/demo.ts`、`core/providers/tts-file.ts`、`core/radio.ts`、`main/bootstrap.ts`、`main/main.ts`、
  `electron-builder.yml`、`renderer/src/App.tsx`、`renderer/src/styles.css`、`tools/make-demo-voice.mjs`、
  `tools/smoke-demo.mjs`、`assets/demo/`；ADR-0008、ADR-0014、ADR-0022、ADR-0029、ADR-0032
- **需求**：`docs/requirements/first-run-demo.md`

## 背景

别人下载 exe 之后的第一印象，是**黑屏无声**：没有 key → `NO_LLM_KEY` → 走本地兜底 → `userData\music` 是空的 →
队列空。而「发布出去的 exe 不包含任何凭证」是本仓库写死的立场（README 诚实声明），所以这条路不是少数人的边界情况，
**是每个人都要先走一遍的那条路**。

手上已经有三件现成的东西，缺的只是一首歌和一段话：本地源按 `Artist - Title.mp3` 认歌，而它恰好是没 cookie 时唯一的源；
口播是内容寻址缓存；出厂嗓已定成 `en_GB-alan-medium`（ADR-0022 追记二）。所以这一轮**一个新界面都不用加** ——
把一首歌和一段话放进包里，走和平时一模一样的那条管道。

## 决策

**① 触发条件是「没有 key」，不是「第一次开机」。** `boot()` 里 `llm.apiKey === ''` 就播 demo，不留旗标、不记「已看过」；
状态就是 prefs 本身。填上 key 的那一刻（`saveSettings` 见 key 从空变非空、且 `lastError` 正是 `NO_LLM_KEY`）重跑一次 `boot()`，
引导横幅自己过期。用 `lastError` 当状态是有意的：它**就是**「这次开机没 key」这件事，再存一个布尔就是第二份真相。

**② 嗓子是「文件 provider」，不是「读用户设置的那个 provider」。** 新增 `createFileTts`（`core/providers/tts-file.ts`）：
把一段**已经合成好的音频**当成一个 provider，它**故意忽略 `req.voice`**。理由两条：这一段要的是「没有 key 也能出声」，
不能反过来依赖用户配的 key（他可能正好配的是 fish）；而且它必须**逐字不变**（用户的要求是「用现在的声音生成一份，固定下来」）。
代价写在明面上：出厂嗓换了，这段音频不会自己跟着换 —— 所以配套一个 `tools/make-demo-voice.mjs`，重跑一遍就换。

**③ 文案在代码里，音频是文件。** 文案（`DEMO_LINE`）要被界面画出来、被测试断言，所以它是常量；音频要被耳朵听、要随包发，
所以它是文件。两者**同源**：脚本读的就是同一个常量，改文案就得重跑脚本，改不动就一起改不动。

**④ 找那首歌走曲库，不拼 id。** `music.library()` 里 `id.endsWith(demo.file)` 找它 —— id 怎么编号是本地源自己的事（ADR-0014 的分工），
拼出来就是越界。

**⑤ 复用 ADR-0029 的口播管道。** demo 那段口播就是一条普通 `intro`：`speak()` 多一个 `engine` 参数只服务这一处，
其余调用方一个字不改；队列 / `now` / 口播卡片 / 缓存回收全部照旧。

**⑥ 歌拷进他的曲库，已存在就不动。** 那首 demo 从这一刻起**是他的**一首本地歌（他可能自己换一份，不许踩掉）。
素材缺了（没打进包 / 曲库里找不到）只 warn 一行，界面回落到原来的红横幅 —— **首次体验坏掉，不许把电台弄坏**。

**⑦ 界面：`NO_LLM_KEY` 不是故障，是「解锁」。** 它画成 `.banner.is-guide` + `SET UP`（点开现有 LOGIN 弹窗），
不再带错误码那个红块；其余错误码原样。文案英文。

## 后果

- **双击即有声**：一首歌 + 一段口播 + 一条引导；不新增组件，界面走的是既有路径（真机证据 `tools/smoke-demo.mjs`）。
- **「仓库里不附带任何音频」这句话不再成立**：`assets/demo/` 里有一首。已在 `docs/references.md` 的版权边界里写明
  「仅个人演示、不构成任何分发承诺」，要拿掉就删掉那个目录 —— 代码会自己回落到红横幅。
- **不设黑名单**：它就在他的曲库里，是普通一首（搜得到、播得到、能点红心）。不污染画像靠的是降级链的顺序，
  细节见需求文档的行为 5。
- **素材在包里的位置**：`electron-builder.yml` 的 `extraResources` 把 `assets/demo` 装成 `resources/demo`；
  `main/main.ts` 打包时读那儿、开发时读仓库。真打了一次便携包核对过：`resources/demo/` 下两份素材都在
  （便携 exe 由 169 MB 长到 **172 MB**）。
- **已知限制**：demo 只有一首、只有一条口播（切到别的歌不会补口播，同 ADR-0026 的老缝）；
  没有 key 时**不排表** —— 队列里就那一首，一分钱都不花在大脑上。