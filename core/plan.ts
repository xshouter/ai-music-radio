import type { DayPlan, PlanBlock, TrackRef } from '../shared/domain.ts';
import type { MusicSource } from '../shared/ports.ts';

/**
 * 日表（DayPlan）—— 一天的**时刻表**，不是内容。
 *
 * 三个时段写死在代码里，理由和 systemPrompt 一样：它是产品的脾气（什么时候该是什么氛围），
 * 不是运维参数。每个时段里的曲目是**尽力而为**的推荐：拿不到就留空数组，
 * 因为"日表里没歌"不影响电台工作（下一首播什么由大脑现场决定）。
 */
const BLOCKS: readonly Omit<PlanBlock, 'tracks'>[] = [
  { start: '07:00', end: '12:00', mood: 'morning', genres: ['acoustic', 'jazz'] },
  { start: '12:00', end: '18:00', mood: 'daytime', genres: ['indie-pop', 'electronic'] },
  { start: '18:00', end: '02:00', mood: 'late-night', genres: ['ambient', 'synthwave'] },
];

export interface DayPlanOptions {
  date: string;
  createdAt: string;
  music: MusicSource;
  perBlock?: number;
}

export async function buildDayPlan(options: DayPlanOptions): Promise<DayPlan> {
  const perBlock = options.perBlock ?? 3;
  const blocks: PlanBlock[] = [];
  for (const block of BLOCKS) {
    const tracks: TrackRef[] = [];
    try {
      const found = await options.music.recommend({ genres: [...block.genres], mood: block.mood }, perBlock);
      for (const track of found) tracks.push({ id: track.id, title: track.title, artist: track.artist });
    } catch {
      // 源不可达：日表里这一格留空，不把整个日表搞坏。
    }
    blocks.push({ ...block, genres: [...block.genres], tracks });
  }
  return { date: options.date, createdAt: options.createdAt, blocks, active: true };
}