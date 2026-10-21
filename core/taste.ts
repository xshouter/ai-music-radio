import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TasteUpdate } from '../shared/domain.ts';
import type { TasteDoc } from '../shared/api-types.ts';
import type { Clock, LlmProvider, MusicSource, Store, TasteRepo } from '../shared/ports.ts';

/**
 * 语料仓库（抽象层第 3.6 节的 `TasteRepo`）。
 *
 * 人写的语料是**磁盘上的 md**，系统的结论是**库里的一行**：
 * 两边永不互相写。所以这里的 `read()` 一半读文件、一半读库，而 `appendLearned()` 只写库。
 */
export interface TasteOptions {
  /** 语料目录。目录不存在 = 还没有语料，不是错误。 */
  dir: string;
  store: Store;
  clock: Clock;
  /** `recent` 最多给几条。 */
  limit?: number;
}

const MARKDOWN = '.md';
const GENRES_FILE = 'genres.txt';
const MAX_CORPUS = 12;
const MAX_CORPUS_CHARS = 2000;

const readText = (file: string): string => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

export function createTasteRepo(options: TasteOptions): TasteRepo {
  const limit = options.limit ?? 20;

  /** 语料：目录里的每一个 .md。按文件名排序 —— 顺序稳定，UI 才不会每次刷新都换位置。 */
  const scan = (): { name: string; text: string }[] => {
    let names: string[];
    try {
      names = readdirSync(options.dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.toLowerCase().endsWith(MARKDOWN))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_CORPUS)
      .map((name) => ({ name, text: readText(join(options.dir, name)).trim().slice(0, MAX_CORPUS_CHARS) }))
      .filter((entry) => entry.text !== '');
  };

  /**
   * 曲风胶囊是**数据**，不是装饰：它写在自己的小文件里，不写死在代码里。
   * 单独一个 .txt 而不是塞进某份 md —— 否则那行声明会跟着语料原文一起显示在 Profile 里。
   */
  const readGenres = (): string[] => {
    const raw = readText(join(options.dir, GENRES_FILE));
    const genres: string[] = [];
    for (const part of raw.split(',')) {
      const tag = part.trim();
      if (tag !== '' && !genres.includes(tag)) genres.push(tag);
    }
    return genres;
  };

  return {
    async read(): Promise<TasteDoc> {
      const recent = await options.store.recentTasteUpdates(limit).catch(() => [] as TasteUpdate[]);
      return { genres: readGenres(), corpus: scan(), recent };
    },

    async appendLearned(line: string, evidence: TasteUpdate): Promise<void> {
      await options.store.appendTasteUpdate({
        ts: options.clock.now().toISOString(),
        text: line,
        evidence: evidence.evidence,
      });
    },
  };
}

/** 机器生成的那一份语料的文件名，**写死**：机器只碰这一个名字，人的语料用别的名字。 */
export const GENERATED_TASTE_FILE = 'taste.md';

export interface TasteBuildOptions {
  music: MusicSource;
  llm: LlmProvider;
  model: string;
  /** 语料目录 —— 与 createTasteRepo 的 dir 是同一个。 */
  dir: string;
  /** 读多少首歌去分析。默认 60。 */
  limit?: number;
}

const TASTE_SYSTEM = [
  'You are the music librarian for exactly one listener. You are given the tracks they keep.',
  'Write their taste profile, in English, as plain prose: no headings, no bullets, no song titles.',
  'Under 90 words. Be specific about what they return to — moods, textures, tempo, era. No flattery.',
].join('\n');

/**
 * 读听众自己的曲库，让模型写一份口味画像，落到 `taste.md`。
 *
 * 三条不肯让步的地方：
 * 1. **已经有一份就不覆盖** —— 那可能是人自己改过的。想重来就删掉文件。
 * 2. 曲库是空的（没 cookie / 歌单没歌）→ 什么都不写，回一个理由，**不抛错**：这是冷启动的常态。
 * 3. 这一笔是账外的：它失败不该把调用方（保存设置）弄失败。
 */
export async function buildTasteFromLibrary(
  options: TasteBuildOptions,
): Promise<{ written: boolean; reason: string; tracks: number }> {
  const file = join(options.dir, GENERATED_TASTE_FILE);
  if (existsSync(file)) return { written: false, reason: 'taste.md already exists', tracks: 0 };

  const size = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 60)));
  const tracks = await options.music.library(size).catch(() => []);
  if (tracks.length === 0) return { written: false, reason: 'no library to read', tracks: 0 };

  const listing = tracks.map((track) => track.artist + ' — ' + track.title).join('\n');
  const response = await options.llm.complete({
    model: options.model,
    messages: [
      { role: 'system', content: TASTE_SYSTEM },
      { role: 'user', content: 'These are the ' + tracks.length + ' tracks this listener keeps:' + '\n\n' + listing },
    ],
    temperature: 0.4,
    maxTokens: 400,
  });
  const prose = response.text.trim();
  if (prose === '') return { written: false, reason: 'model returned nothing', tracks: tracks.length };

  mkdirSync(options.dir, { recursive: true });
  writeFileSync(file, prose + '\n', 'utf8');
  return { written: true, reason: '', tracks: tracks.length };
}
