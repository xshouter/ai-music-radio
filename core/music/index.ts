import type { QualityLevel } from '../../shared/domain.ts';
import type { MusicSource } from '../../shared/ports.ts';

/** 音质档位，从高到低。降级时按这个顺序往下试（抽象层第 6 节）。 */
export const LEVELS: readonly QualityLevel[] = ['lossless', 'exhigh', 'higher', 'standard'];

/**
 * 降级链。**降级是链的职责，不是调用方的职责**（端口注释）。
 *
 * 三条规则：
 * 1. 一个源抛错 / 返回空 → 换下一个源。源坏了不该把电台停掉。
 * 2. `resolve` 是"档位 × 源"的笛卡尔积：从**请求的那一档**往下试，任一对成功就返回。
 * 3. 全失败 → 返回 null（或空数组），不抛错；但会喊一次 onUnreachable —— 
 *    "源不在"和"没这首"对用户是两码事，只有链自己知道刚才摔的是哪一个。
 *
 * 为什么不把链写成"每一个源自己会降级"：那样"到底降了几档、换到第几个源"就不可观测了，
 * 而这两件事正是 UI 上 `DEGRADED` 徽标要说清楚的东西。
 */
export interface MusicChainOptions {
  /**
   * 每个源都空手而归、且至少有一个源是**抛错**走的 → 喊一声。
   * 链把"源不在"和"没搜到"都收敛成空结果（既定取舍），但用户那边这是两码事：
   * 一个该去起兼容服务 / 换 cookie，一个只是库里没这首。不喊这一声，
   * 用户看到的就是"电台死了，而且一句话都不说"。
   */
  onUnreachable?: (cause: unknown) => void;
}

export function createMusicSourceChain(
  sources: readonly MusicSource[],
  options: MusicChainOptions = {},
): MusicSource {
  if (sources.length === 0) throw new Error('music chain: 至少要有一个源');

  const firstNonEmpty = async <T>(run: (source: MusicSource) => Promise<T[]>): Promise<T[]> => {
    let lastError: unknown = null;
    for (const source of sources) {
      try {
        const result = await run(source);
        if (result.length > 0) return result;
      } catch (error) {
        // 这个源不可达：下一个。链的存在意义就是不把单点故障传出去。
        lastError = error;
      }
    }
    if (lastError !== null) options.onUnreachable?.(lastError);
    return [];
  };

  return {
    id: 'chain',

    recommend: (seed, limit) => firstNonEmpty((source) => source.recommend(seed, limit)),

    search: (keywords, limit) => firstNonEmpty((source) => source.search(keywords, limit)),

    // 曲库同理：主源读不到他的歌单（没 cookie / 服务不在）就退到本地目录。
    library: (limit) => firstNonEmpty((source) => source.library(limit)),

    async resolve(songId, level) {
      const from = LEVELS.indexOf(level);
      let lastError: unknown = null;
      for (const candidate of LEVELS.slice(from < 0 ? 0 : from)) {
        for (const source of sources) {
          try {
            const audio = await source.resolve(songId, candidate);
            if (audio !== null) return audio;
          } catch (error) {
            // 同上：换下一个。
            lastError = error;
          }
        }
      }
      if (lastError !== null) options.onUnreachable?.(lastError);
      return null;
    },
  };
}