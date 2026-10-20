import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TasteUpdate } from '../shared/domain.ts';
import type { TasteDoc } from '../shared/api-types.ts';
import type { Clock, Store, TasteRepo } from '../shared/ports.ts';

/**
 * 语料仓库（抽象层第 3.6 节的 `TasteRepo`）。
 *
 * 人写的语料是**磁盘上的 md**，系统的结论是**库里的一行**（ADR-0004）：
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
   * 曲风胶囊是**数据**，不是装饰（ADR-0010）：它写在自己的小文件里，不写死在代码里。
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