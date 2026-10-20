import type { DayPlan, DjMessage, PlayEvent, PlayStats, TasteUpdate, TrackRef } from '../../shared/domain.ts';
import type { Clock, PrefKey, PrefMap, Store } from '../../shared/ports.ts';
import { isPrefKey, parsePref } from './prefs.ts';

/**
 * `Store` 的内存替身：零依赖、零 IO。
 * 两个用途 —— ① tests/ 里断言它与 SqliteStore 行为一致；② 4.5 的调度器测试不必起真库。
 * 它不是「简化版」：语义与 SqliteStore / mock 逐条对齐，否则它证明不了任何东西。
 */
export class MemoryStore implements Store {
  private readonly clock: Clock;
  private readonly warn: (message: string) => void;
  private messages: DjMessage[] = [];
  private plays: (PlayEvent & { replay: boolean })[] = [];
  private favs: TrackRef[] = [];
  private prefs = new Map<string, string>();
  private plans = new Map<string, DayPlan>();
  private taste: TasteUpdate[] = [];

  constructor(clock: Clock, warn: (message: string) => void = () => {}) {
    this.clock = clock;
    this.warn = warn;
  }

  async appendMessage(m: DjMessage): Promise<void> {
    this.messages.push({ ...m });
  }

  async recentMessages(limit: number): Promise<DjMessage[]> {
    return takeNewest(this.messages, limit, 50, (m) => m.ts).map((m) => ({ ...m }));
  }

  async recordPlay(p: PlayEvent): Promise<void> {
    if (p.endedAt === null) {
      const replay = this.plays.some((play) => play.songId === p.songId);
      this.plays.push({ ...p, replay });
      return;
    }
    const open = findLast(this.plays, (play) => play.songId === p.songId && play.endedAt === null);
    if (open === undefined) return;
    open.endedAt = p.endedAt;
    open.skipped = p.skipped;
  }

  async recentPlays(limit: number): Promise<PlayEvent[]> {
    return takeNewest(this.plays, limit, 50, (p) => p.ts).map(({ replay, ...play }) => ({ ...play }));
  }

  async playStats(since: Date): Promise<PlayStats> {
    const inWindow = this.plays.filter((p) => new Date(p.ts) >= since);
    const byArtist = new Map<string, number>();
    for (const play of inWindow) byArtist.set(play.artist, (byArtist.get(play.artist) ?? 0) + 1);
    return {
      played: inWindow.length,
      skipped: inWindow.filter((p) => p.skipped).length,
      replays: inWindow.filter((p) => p.replay).length,
      topArtists: [...byArtist]
        .map(([artist, count]) => ({ artist, count }))
        .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist))
        .slice(0, 5),
    };
  }

  async savePlan(p: DayPlan): Promise<void> {
    this.plans.set(p.date, { ...p, blocks: p.blocks.map((b) => ({ ...b, genres: [...b.genres], tracks: [...b.tracks] })) });
  }

  async activePlan(date: string): Promise<DayPlan | null> {
    return this.plans.get(date) ?? null;
  }

  async favorites(): Promise<TrackRef[]> {
    return this.favs.map((f) => ({ ...f }));
  }

  async setFavorite(track: TrackRef, liked: boolean): Promise<void> {
    if (!liked) {
      this.favs = this.favs.filter((f) => f.id !== track.id);
      return;
    }
    if (!this.favs.some((f) => f.id === track.id)) this.favs.push({ ...track });
  }

  async getPref<K extends PrefKey>(key: K): Promise<PrefMap[K] | null> {
    if (!isPrefKey(key)) return null;
    const raw = this.prefs.get(key);
    return parsePref(key, raw === undefined ? null : raw, this.warn);
  }

  async setPref<K extends PrefKey>(key: K, value: PrefMap[K]): Promise<void> {
    this.prefs.set(key, String(value));
  }

  async appendTasteUpdate(u: TasteUpdate): Promise<void> {
    this.taste.push({ ...u });
  }

  async recentTasteUpdates(limit: number): Promise<TasteUpdate[]> {
    return takeNewest(this.taste, limit, 20, (u) => u.ts).map((u) => ({ ...u }));
  }
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) if (predicate(items[i])) return items[i];
  return undefined;
}

/** 与 SQL 的「倒序 + limit 夹住」一致：ts 降序，时间戳相同时越晚插入越靠前。 */
function takeNewest<T>(items: T[], limit: number, fallback: number, tsOf: (item: T) => string): T[] {
  const size = !Number.isFinite(limit) ? fallback : Math.max(1, Math.trunc(limit));
  const reversed = [...items].reverse();
  reversed.sort((a, b) => {
    const left = tsOf(a);
    const right = tsOf(b);
    return left < right ? 1 : left > right ? -1 : 0;
  });
  return reversed.slice(0, size);
}