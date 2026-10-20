# 需求：音乐源与降级链（`core/music/`，阶段 4.3）

> 铁律 2 的产出。回答"音乐这一层被要求做什么"。加密层的边界见 ADR-0016。

## 目标

让电台**几乎不会哑**：优先放用户真正想听的（网易云），拿不到就退到本地目录，
再拿不到就让上层进 `degraded`（UI 显示 `DEGRADED` 徽标）。**任何一环失败都不许抛异常。**

## 端口（`shared/ports.ts` 第 3.3 节，已冻结，不改）

```ts
interface MusicSource {
  readonly id: string;
  recommend(seed: MusicSeed, limit: number): Promise<Track[]>;
  search(keywords: string, limit: number): Promise<Track[]>;
  resolve(songId: string, level: QualityLevel): Promise<ResolvedAudio | null>;
}
```

## 三个实现

| 实现 | 角色 | 关键行为 |
|---|---|---|
| `NeteaseSource` | 主源 | 场景词 → `/cloudsearch`；无场景词 → `/recommend/songs`（要登录）→ 失败退 `/personalized/newsong`；`resolve` 用 `/song/url/v1`，只试请求的那一档 |
| `LocalSource` | 兜底 | 目录里 `Artist - Title.mp3`；不做 ID3；`resolve` 回 `file://` |
| `MusicSourceChain` | 链 | 源抛错/返回空 → 换下一个；`resolve` 是"档位 × 源"的笛卡尔积，从请求档往下；全失败 → `null` |

## 降级顺序（写死，不再问）

| 维度 | 顺序 |
|---|---|
| 音质 | `lossless → exhigh → higher → standard`（用户请求的那一档开始往下） |
| 源 | `netease → local` |
| 全失败 | `resolve` 返回 `null`；`recommend`/`search` 返回 `[]`。**不抛错**，由上层判 `degraded` |

## `limit` 的夹法

`[1, 50]`，非法值回默认（`search` 默认 10，`recommend` 默认 6）。
与 ADR-0013 一致：错误码是封闭枚举，里面没有"参数不合法"。

## 明确写下来的假设

- **假设 1**：加密层由**兼容服务**承担（ADR-0016）。使用者要么自备这个服务，要么退到本地目录。
  这是 v1 已知的不闭环处，写进 README。
- **假设 2**：cookie 是**整条头**（ADR-0011），只进不出：不进日志、不进错误消息、不回显。
- **假设 3**：`degraded` 由上层**推断**（队列里只剩本地源），不新增一个"我降级了"的接口 —— 少一个能说谎的状态。
- **假设 4**：本地源不做 ID3 解析 —— 多一个库换一个"封面没读到就崩"的故障点不划算。
- **假设 5**：`Search` 一个字都没匹配上时返回全部候选。兜底源的职责是"别让电台哑掉"，不是"严格匹配"。

## 明确不做

- 不内联任何第三方实现的代码（roadmap 阶段 4 的约定）。
- 不做歌单 / 专辑 / 歌手页。
- 不做下载与离线缓存（`core/tts.ts` 的缓存只覆盖口播，见 4.4）。