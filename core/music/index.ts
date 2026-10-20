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
 * 3. 全失败 → 返回 null（或空数组），不抛错。调用方据此进 `degraded`，而不是收到一个异常。
 *
 * 为什么不把链写成"每一个源自己会降级"：那样"到底降了几档、换到第几个源"就不可观测了，
 * 而这两件事正是 UI 上 `DEGRADED` 徽标要说清楚的东西。
 */
export function createMusicSourceChain(sources: readonly MusicSource[]): MusicSource {
  if (sources.length === 0) throw new Error('music chain: 至少要有一个源');

  const firstNonEmpty = async <T>(run: (source: MusicSource) => Promise<T[]>): Promise<T[]> => {
    for (const source of sources) {
      try {
        const result = await run(source);
        if (result.length > 0) return result;
      } catch {
        // 这个源不可达：下一个。链的存在意义就是不把单点故障传出去。
      }
    }
    return [];
  };

  return {
    id: 'chain',

    recommend: (seed, limit) => firstNonEmpty((source) => source.recommend(seed, limit)),

    search: (keywords, limit) => firstNonEmpty((source) => source.search(keywords, limit)),

    async resolve(songId, level) {
      const from = LEVELS.indexOf(level);
      for (const candidate of LEVELS.slice(from < 0 ? 0 : from)) {
        for (const source of sources) {
          try {
            const audio = await source.resolve(songId, candidate);
            if (audio !== null) return audio;
          } catch {
            // 同上：换下一个。
          }
        }
      }
      return null;
    },
  };
}