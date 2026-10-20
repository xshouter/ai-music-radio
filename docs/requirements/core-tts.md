# 需求：口播合成与缓存（`core/tts.ts`，阶段 4.4）

> 铁律 2 的产出。回答"口播这一层被要求做什么"。用谁的嗓子已由 [ADR-0022](../adr/0022-tts-piper-offline.md) 定案（默认**离线 Piper**，fish 保留为可选）；本文件只管形状与失败语义。

## 目标

让每个界面上大段文字都有对应音频：合一句、放一句、按词高亮、算得出进度。**任何合成失败都不许把音乐停掉。**

## 端口（`shared/ports.ts` 第 3.2 节，已冻结，不改）

```ts
interface TtsProvider {
  readonly id: string;
  readonly format: 'mp3' | 'wav';                    // 容器格式是引擎级属性（ADR-0022）
  synthesize(req: TtsRequest): Promise<TtsResult>;   // { audio: Uint8Array; contentType: string }
}
```

provider **只负责一次调用**。缓存、重试、词时间戳、路径映射都在 `core/tts.ts` —— provider 必须是叶子。

## 两个实现

| 实现 | 角色 | 关键行为 |
|---|---|---|
| `PiperTts`（`core/providers/tts-piper.ts`） | 嗓子（**默认**） | 本地 `piper.exe`：文本喂 stdin、WAV 写临时文件读回，`format: 'wav'`；**运行时必须在纯 ASCII 路径**（ADR-0022） |
| `TtsEngine`（`core/tts.ts`） | 编排 | 内容寻址缓存 + 失败重试 1 次 + 由音频真时长推词时间戳 |
| `FishTts`（`core/providers/tts-fish.ts`） | 嗓子 | `POST https://api.fish.audio/v1/tts`，`Authorization: Bearer`；音色走 body 的 `reference_id` |

## 缓存（写死，不再问）

- 键 = `sha1(providerId + \u0000 + 音色 + \u0000 + 文本)`，落缓存目录（`main/` 传的是用户数据目录下的 `data/cache`）里的 `<hash>.<ext>`，`ext` 就是 provider 的 `format`。
- 键里**必须**含 providerId 与音色：换 provider / 换嗓子不能串到旧缓存（`shared/ports.ts` 的注释）。
- 命中缓存 = 零远端调用。同一句话重复口播（如 REPLAY）不花钱。

## 词时间戳（写死，理由见 ADR-0017）

- 形状是契约里的 `SpokenLine { index; line; audioUrl; words[] }`（ADR-0012），本层负责把它填满。
- **音频总长是真的**：按 `format` 选解析器 —— `mp3DurationMs()` 只读帧头不解码，`wavDurationMs()` 读 RIFF 的 `fmt `/`data` 块，两者都从真字节算总长。
- **逐词边界按文本长度比例分配**，末词一定收在真实总长上（四舍五入不能让音频尾部没有词覆盖）。
- 时长拿不到（<= 0）→ 退化成"一个覆盖全句的词"，UI 自动变整句高亮。形状不变。

## 失败语义（抽象层第 6 节）

- 超时 / 限流 / 额度用尽 / 空音频 → 退避重试 **1 次** → 仍失败抛 `TtsFailure`（`code: 'TTS_FAILED'`）。
- 调用方（调度器 / server）拿到它必须**跳过这句、继续放歌**，不许停台。
- **不做无限重试**：付费接口 + 用户在旁边等，重试两次已经是上限。

## 明确写下来的假设

- **假设 1**（已被 ADR-0022 修正）：容器格式是**引擎级属性**（`TtsProvider.format`），引擎按它选后缀、`Content-Type` 与时长解析方式。v1 只有两种：fish 回 mp3、piper 回 wav；没有第三种格式，也不做通用容器嗅探。
- **假设 2**：`HttpResponse` 只有 `status/text/bytes`，没有 headers。mp3 的内容类型是常量，provider 里写死 `audio/mpeg`。
- **假设 3**：缓存目录由调用方（`main/`）给定，`cache/` 已在 `.gitignore` 里 —— 音频是运行时数据，不进仓库。
- **假设 4**：口播语言是英文（`docs/references.md`），默认音色面向英文场景；Piper 换中文 = 换一个音色模型文件，fish 换 `reference_id`。

## 明确不做

- 不做流式合成（逐字出声）。v1 是"整句合成 → 整句播"，与 ADR-0001 的逐句推对齐。
- 不做**第三个** provider 实现（第 9 节：没有真实需求就不做）。v1 只有 Piper（默认）与 fish（可选）两个。
- 不做歌词 / 不做音乐离线缓存（ADR-0009；本缓存只覆盖口播）。