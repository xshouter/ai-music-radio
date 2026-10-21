# 需求（草稿 · 待确认）· 口播真出声、模型不用手打、播放器真能用

- **状态**：**待确认** —— 第 4 节的假设不反对就按它做，然后冻结、写代码（铁律 2）
- **来源**：用户 2026-10-21 拿着 0.1.7 的便携版实测，回来的六条口头反馈
- **关联**：`core/radio.ts`、`core/server.ts`、`core/prompt.ts`、`core/brain/index.ts`、
  `shared/api-types.ts`、`mock/server.mjs`、`renderer/src/components/Credentials.tsx`、
  `renderer/src/components/Transport.tsx`、`renderer/src/hooks/useRadio.ts`；
  ADR-0008（嗓子是端口）、ADR-0022（piper 是默认）、ADR-0025（口味画像）、
  ADR-0026（口播挂在曲目上）、ADR-0036 / ADR-0037（这一轮的决策）

## 1. 现状（事实）

用户报了六条。查完发现其中四条是**同一类毛病**：界面说的，和电台实际做的，不是一回事。

| # | 用户原话 | 实测到的实情 |
|---|---|---|
| 1 | 「现在放歌的时候没有口播」 | 两处。`holdIntros` 挂起来的那几句**只有自然放完**才推 —— 点队列切歌、点上一首，走的是 `POST /api/playback { event: 'started' }`，那条路上原来一个字都不说；`ttsProviderFor` 只看 `tts.provider === 'fish'`，**不看有没有 key**，于是选了 fish 而 key 是空的就一直打远端、一直失败。 |
| 2 | 「用户可以选择使用 tts 或者 piper，没有 tts 设置时默认 piper，不需要显示音色」 | 默认值本来就是 piper（ADR-0022），但界面把「音色」摆成一格让人填 —— 等于把「随包的那把嗓子」说成一件要配置的事。 |
| 3 | 「填入 apikey 和 baseurl 后自动读取可用模型列表，做成下拉框让用户选」 | `llm.model` 是一格自由文本。拼错一个字母，报出来的是上游的 400/404，从界面上看不出是自己手滑。 |
| 4 | 「你手搓的播放器不太好用」 | 进度条是一个 **3px 的 `<div>`**：不能点、不能拖。整条 `<audio>` 管道是手搓的（自己听 `timeupdate`、自己处理换源、换歌要重挂监听）。 |
| 5 | 「真的走了读取用户音乐列表的并生成 taste.md 再生成推荐音乐的流程吗」 | **没走。** `learnTaste()` 的触发条件是「cookie 从无到有」，cookie 早就填过的人**永远不成立**，`taste.md` 一直不存在，日表也就一直没有口味可参考。`%APPDATA%\EdgeRunner\taste\` 目录不存在，是它没跑过的直接证据。 |
| 6 | 「口播内容有点短了，应该在 15-20 秒内」 | 提示词写的是「One or two sentences, under 30 words」—— 念出来约 8 秒。 |

## 2. 要什么

1. 每首歌轮到的时候都听得见那一条口播 —— 自然放完、点队列、点上一首 / 下一首，都一样。
2. 嗓子只有一个问题要回答：用随包的 piper，还是用 HTTP 的 TTS。**没有 key 的 TTS = 没选 TTS。**
3. 填了端点（和钥匙）之后，模型名从下拉框里挑，不用背。
4. 进度条能点、能拖。
5. cookie 与 key 齐了，口味画像就该自己长出来 —— 不用等着「某一次是第一次填 cookie」。
6. 每条口播念出来 15-20 秒。

## 3. 设计

- **嗓子回落**：`ttsProviderFor` 的判据从「选了 fish」改成「选了 fish **且**有 key」（`core/radio.ts`）。
  选了 fish 却没给 key，落到 piper —— 离线、零 key、随包就在。
- **挂起来的口播顺手先合**：`holdIntros` 在挂起的同时后台预合成（尽力而为，失败静默）。
  轮到那首歌时是一次缓存命中，切歌不用等合成。
- **切歌就开口播**：`speakHeld(id)` 成为唯一的出口 —— `advance()`（自然放完）与
  `POST /api/playback { event: 'started' }`（点队列 / 点上一首）两条路都走它。
  同一首只说得出口一次（说出去就从 `heldSay` 里删掉）。
- **模型目录**：新契约 `POST /api/models { baseUrl, apiKey? } -> { models: string[] }`。
  服务端打 `GET {baseUrl}/models`，取 `data[].id`，去重、排序。`apiKey` 缺省用库里存的那把
  （现填的优先，明文只用一趟、不落库、不落日志）。界面把它灌进 `<datalist>` ——
  既是下拉框，也能手打（端点不支持 `/models` 时不至于卡死）。
- **音色那一格删掉**。TTS 块只剩 PROVIDER 一个 `<select>`（piper / fish）：选 piper 时给一句话
  说明它随包、离线、不用填；选 fish 才问端点与钥匙。
- **播放引擎换 Howler**（ADR-0037）。运输条的 `.track` 从 `<div>` 变成 `<button>`，
  点与拖都跳到那一刻；3px 的条用伪元素把命中区上下各撑 9px（视觉一点不变）。
- **口味画像改在开机时补**：`boot()` 在排表之前先 `await learnTaste()`；`saveSettings` 去掉
  「cookie 从无到有」那个条件，改成无条件补一次（已经有一份时读一眼文件名就回来，重复调用是便宜的）。
- **口播长度**：`core/prompt.ts:27` 与 `core/brain/index.ts:112` 各有一处长度约束，
  一起改成「Two or three sentences, 40-55 words — that is 15-20 seconds spoken」。
  两处必须一致，`tests/core/prompt.test.mjs` 最后一条钉住它。

## 4. 假设（不反对就按这个做）

| # | 假设 | 理由 |
|---|---|---|
| 1 | 模型列表拉不到时**不报错**，安静地退回手打 | 端点不支持 `/models` 是常态。下拉框是方便，不是门槛 |
| 2 | 用 `<datalist>` 而不是 `<select>` | 前者既能挑也能打；后者把「端点没列出来但确实能用」的模型锁死 |
| 3 | 音色**不在界面上**给 | 用户明确说不要。换音色仍是 `tools/fetch-voice.mjs` 的事（ADR-0022） |
| 4 | 预合成失败静默，真说的时候再说一次 | 挂起来那一下是抢时间，不是承诺；失败留到 `speak()` 那一处报 `TTS_FAILED` |
| 5 | 口味画像的触发点改成「开机 + 每次存设置」，不加按钮 | 它本来就该自己长出来（ADR-0025 的意图）；加按钮等于把系统该做的事推给用户 |
| 6 | 播放引擎用 Howler（成熟开源库），界面仍然自己画 | 视觉 1:1 复刻是这一档的硬要求，嵌一个别人的播放器皮肤会当场破坏它。要换的是**引擎**与**可用性**，不是皮肤 |

## 5. 验收

- 点队列里的任意一首 -> 它在 `say` 里那一句真的出来，音频 URL 与词表同源。
- `tts.provider = fish` 且 `tts.apiKey` 为空 -> `/v1/tts` **一次都没被打**，文字照给。
- 填一个能用的端点 -> 模型下拉框里有东西；填一个瞎写的端点 -> 安静地退回手打，不报错。
- 拖进度条 -> 位置真的跟手，松开之后停在那一刻。
- 清掉 `taste/<taste.md>` -> 开机之后它自己回来（cookie 与 key 都在的前提下）。
- 一条口播的音频时长落在 15-20 秒。