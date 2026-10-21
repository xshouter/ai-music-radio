import type { DayPlan, PlanBlock, TrackRef } from '../shared/domain.ts';
import type { MusicSource } from '../shared/ports.ts';

/**
 * 日表（DayPlan）—— 一天的**时刻表**，不是内容。
 *
 * 三个时段写死在代码里，理由和 systemPrompt 一样：它是产品的脾气（什么时候该是什么氛围），
 * 不是运维参数。每个时段里的曲目是**尽力而为**的推荐：拿不到就留空数组，
 * 因为"日表里没歌"不影响电台工作（下一首播什么由大脑现场决定）。
 */
export type PlanBlockSpec = Omit<PlanBlock, 'tracks'>;

const BLOCKS: readonly PlanBlockSpec[] = [
  { start: '07:00', end: '12:00', mood: 'morning', genres: ['acoustic', 'jazz'] },
  { start: '12:00', end: '18:00', mood: 'daytime', genres: ['indie-pop', 'electronic'] },
  { start: '18:00', end: '02:00', mood: 'late-night', genres: ['ambient', 'synthwave'] },
];

/** 每格几首 —— 提示词与搜索兜底共用这一个数。 */
export const PLAN_PER_BLOCK = 3;

/**
 * 排表的人：给它三个槽位，它回三格的歌；回 null = 这一轮排不出来。
 * 它是**可选**的 —— 没有它（或者它失败），`buildDayPlan` 就是原来那个「逐格搜索」。
 */
export type PlanCurator = (blocks: readonly PlanBlockSpec[]) => Promise<TrackRef[][] | null>;

export interface DayPlanOptions {
  date: string;
  createdAt: string;
  music: MusicSource;
  perBlock?: number;
  /** 有它就先问它（LLM 从日推候选池里挑）。它失败、或某几格空着 → 那些格退到搜索。 */
  curate?: PlanCurator;
}

/** 一格拿不到歌就回空数组：源不可达不该把整个日表搞坏。 */
const searchBlock = async (music: MusicSource, block: PlanBlockSpec, limit: number): Promise<TrackRef[]> => {
  try {
    const found = await music.recommend({ genres: [...block.genres], mood: block.mood }, limit);
    return found.map((track) => ({ id: track.id, title: track.title, artist: track.artist }));
  } catch {
    return [];
  }
};

// shortcut: 排表的提示词按 PLAN_PER_BLOCK 写死「每格 3 首」，perBlock 传别的值时提示词不跟着变；真要支持就把 perBlock 传进 curator。
export async function buildDayPlan(options: DayPlanOptions): Promise<DayPlan> {
  const perBlock = options.perBlock ?? PLAN_PER_BLOCK;
  // 排表那一轮的任何失败都只是一次退让：抛错、说话不算数、模型吐坏 JSON —— 全在这一个 catch 里。
  const curated = options.curate === undefined ? null : await options.curate(BLOCKS).catch(() => null);
  const blocks: PlanBlock[] = [];
  for (const [index, block] of BLOCKS.entries()) {
    // 排表那一轮给了这一格就用它；没给、或者给了个空的，才轮到搜索兜底。
    const fromCurator = curated?.[index] ?? [];
    const tracks = fromCurator.length > 0 ? fromCurator : await searchBlock(options.music, block, perBlock);
    blocks.push({ ...block, genres: [...block.genres], tracks });
  }
  return { date: options.date, createdAt: options.createdAt, blocks, active: true };
}