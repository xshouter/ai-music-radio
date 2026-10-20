# 需求：口播合成与缓存（`core/tts.ts`，阶段 4.4）

> 铁律 2 的产出。回答"口播这一层被要求做什么"。用谁的嗓子已由 ADR-0008 定案；本文件只管形状与失败语义。

## 目标

让每个界面上大段文字都有对应音频：合一句、放一句、按词高亮、算得出进度。**任何合成失败都不许把音乐停掉。**

## 端口（`shared/ports.ts` 第 3.2 节，已冻结，不改）

```ts
interface TtsProvider {
  readonly id: string;
  synthesize(req: TtsRequest): Promise<TtsResult>;   // { audio: Uint8Array; contentType: string }
}
```

provider **只负责一次调用**。缓存、重试、词时间戳、路径映射都在 `core/tts.ts` —— provider 必须是叶子。

## 两个实现

| 实现 | 角色 | 关键行为 |
|---|---|---|
| `TtsEngine`（`core/tts.ts`） | 编排 | 内容寻址缓存 + 失败重试 1 次 + 由音频真时长推词时间戳 |
| `FishTts`（`core/providers/tts-fish.ts`） | 嗓子 | `POST https://api.fish.audio/v1/tts`，`Authorization: Bearer`；音色走 body 的 `reference_id` |

## 缓存（写死，不再问）

- 键 = `sha1(providerId + \u0000 + 音色 + \u0000 + 文本)`，落 `cache/tts/<hash>.mp3`。
- 键里**必须**含 providerId 与音色：换 provider / 换嗓子不能串到旧缓存（`shared/ports.ts` 的注释）。
- 命中缓存 = 零远端调用。同一句话重复口播（如 REPLAY）不花钱。

## 词时间戳（写死，理由见 ADR-0017）

- 形状是契约里的 `SpokenLine { index; line; audioUrl; words[] }`（ADR-0012），本层负责把它填满。
- **音频总长是真的**：`mp3DurationMs()` 只读帧头不解码，从真实字节算出总长。
- **逐词边界按文本长度比例分配**，末词一定收在真实总长上（四舍五入不能让音频尾部没有词覆盖）。
- 时长拿不到（<= 0）→ 退化成"一个覆盖全句的词"，UI 自动变整句高亮。形状不变。

## 失败语义（抽象层第 6 节）

- 超时 / 限流 / 额度用尽 / 空音频 → 退避重试 **1 次** → 仍失败抛 `TtsFailure`（`code: 'TTS_FAILED'`）。
- 调用方（调度器 / server）拿到它必须**跳过这句、继续放歌**，不许停台。
- **不做无限重试**：付费接口 + 用户在旁边等，重试两次已经是上限。

## 明确写下来的假设

- **假设 1**：mp3 就够 —— 不再引入第二种音频格式与对应解码器。Fish 默认回 mp3。
- **假设 2**：`HttpResponse` 只有 `status/text/bytes`，没有 headers。mp3 的内容类型是常量，provider 里写死 `audio/mpeg`。
- **假设 3**：缓存目录由调用方（`main/`）给定，`cache/` 已在 `.gitignore` 里 —— 音频是运行时数据，不进仓库。
- **假设 4**：口播语言是英文（`docs/references.md`），默认音色面向英文场景；换中文只需换 `reference_id`。

## 明确不做

- 不做流式合成（逐字出声）。v1 是"整句合成 → 整句播"，与 ADR-0001 的逐句推对齐。
- 不做第二个 provider 实现（第 9 节：没有第二个真实需求就先不做）。
- 不做歌词 / 不做音乐离线缓存（ADR-0009；本缓存只覆盖口播）。