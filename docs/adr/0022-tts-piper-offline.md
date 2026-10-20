# ADR-0022 · 口播语音引擎换成 Piper（离线本地）

- **状态**：已接受
- **日期**：2026-10-20
- **关联**：`core/providers/tts-piper.ts`、`core/tts.ts`、`core/radio.ts`、`core/server.ts`、`main/tts-runtime.ts`、`tools/fetch-voice.mjs` ｜ 取代 [ADR-0008](0008-tts-fish-audio.md)

## 背景

ADR-0008 把口播的语音交给 Fish Audio 的托管 API。真去落地时才发现，**这条路上没有一环是通的**。逐条实测（本机，2026-10-20）：

1. **Fish Audio 根本到不了**：`fish.audio` 与 `api.fish.audio` 的 DNS 被污染成假 IP，HEAD 请求一律超时。官网打不开 → 拿不到 key；就算手里有 key，API 主机本身也不通。
2. **Fish Audio 官方 GitHub（28 个仓库）没有能塞进便携 exe 的东西**：
   - `fish-speech`（33k★，MIT）是自托管服务，要 GPU + 数 GB 权重；它对外的 HTTP 面是 `POST /v1/tts`。
   - `s1-mini`（0.5B）在 HF 上是 **gated** 仓库，且许可是 **CC-BY-NC-SA-4.0（非商用）** —— 不能进一个要分发出去的作品集。
   - `docs` 里的自托管是企业形态的 Kubernetes / Docker：最省的 all-in-one 也要 **H100 级 80GB 卡**，还得先有企业协议、再登录 fish.audio 建 deploy token。
   - 其余仓库（各语言 SDK、Claude Code 插件、Bert-VITS2、OpenUtau、`fish-scales-ops`）要么只是调托管 API 的壳，要么是 AGPL 或 CUDA 算子，都不相关。
3. **百炼这把 key 不做语音**：`GET /models` 通（19 个模型，含 TTS），但 `/audio/speech` 400、`tts-1` 404、`chat/completions + modalities:['text','audio']` 500 —— 这个网关只放通 chat 路由。
4. **Edge TTS 不要**：上游现在要求带一个刻意混淆的 DRM token（上游 `drm.py` 里几十行混淆常数）。把这种东西当作品集的依赖是负资产。
5. **本机 SAPI 只有 1990 年代的嗓子**（Zira / David / Huihui），配不上这个界面。

## 决策

**口播默认走 Piper**：MIT、离线、纯 CPU、装好就出声。`npm run fetch:voice` 把运行时与音色拉到 `vendor/piper/`，打包时进 `resources/piper`。

抽象层跟着动一处：`TtsProvider` 增加 `format: 'mp3' | 'wav'`。**容器格式是引擎级属性** —— 缓存后缀、响应的 `Content-Type`、时长解析都该由它决定，而不是写死 mp3。

- `core/tts.ts`：`ext = provider.format` 决定缓存文件名与 `urlOf`；wav 走 `wavDurationMs()`（读 RIFF 的 `fmt ` / `data` 块）。
- `core/server.ts`：`TTS_PATH` 收 `mp3|wav`，wav 回 `audio/wav`。
- `core/radio.ts`：`ttsProviderFor(prefs, ttsDir, http)` —— `piper`（默认）或 `fish`。

**Fish 不删**：`core/providers/tts-fish.ts` 留着，`tts.provider=fish` 加 `tts.baseUrl` 就能切回（托管端点，或自己跑的 `fish-speech` —— 两者都是 `POST /v1/tts`，同形）。

## 后果

- **好处**：零 key、零网络，口播永远有声；许可与体积都干净（`piper.exe` 0.49MB + onnxruntime 8.8MB + 音色 60MB）。
- **好处**：`format` 成了引擎属性，以后换任何引擎（本地或托管、wav 或 mp3）都不用再碰缓存与路由。
- **代价**：**`piper.exe` 只能从纯 ASCII 路径运行** —— espeak-ng 用 `fopen` 读 `espeak-ng-data/phontab`，中文路径下直接崩，而且**静默产出 0 字节**。所以 `main/tts-runtime.ts` 的 `resolveTtsDir` 在安装路径非 ASCII 时，把整份运行时拷到第一个可写的 ASCII 落点（纯函数、不 import electron，冒烟脚本共用同一套规则）。
- **代价**：音质不如 Fish Audio 的商业模型；`en_US-amy-medium` 是"清楚的女声"，不是"有性格的 DJ"。
- **重新打开的条件**：能拿到托管 TTS 的 key（或有一台带 GPU 的机器自托管 `fish-speech`）时，把 `tts.provider` 切到 `fish` —— 抽象层不变，只换一个 provider 实现。