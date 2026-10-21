import type {
  DayPlan,
  DjMessage,
  PlayEvent,
  PlayStats,
  QualityLevel,
  TasteUpdate,
  TrackRef,
} from '../../shared/domain.ts';
import type { Clock, PrefKey, PrefMap, Store } from '../../shared/ports.ts';
import { MIGRATIONS } from './migrations/index.ts';
import { isPrefKey, parsePref } from './prefs.ts';

/**
 * 结构化驱动接口 —— core/ **不认识** node:sqlite，也不认识 better-sqlite3。
 * 谁注入它谁负责 `new DatabaseSync(path)`（唯一组装点是 main/bootstrap.ts）。
 * 这样做的直接好处：core/ 能在 `npm test` 里用内存驱动跑，也能在 Electron 里跑，两处都不改 core。
 */
export interface SqlStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

interface MessageRow { id: string; ts: string; role: string; text: string; meta: string | null }
interface PlayRow {
  ts: string; song_id: string; title: string; artist: string; source: string; level: string;
  started_at: string; ended_at: string | null; skipped: number; reason: string | null;
}
interface FavoriteRow { song_id: string; title: string; artist: string }
interface PlanRow { date: string; created_at: string; blocks: string; active: number }
interface TasteRow { ts: string; text: string; evidence: string }
interface PrefRow { value: string }
interface CountRow { n: number }

const asMessage = (row: MessageRow): DjMessage => {
  const message: DjMessage = { id: row.id, ts: row.ts, role: row.role as DjMessage['role'], text: row.text };
  if (row.meta !== null) message.meta = JSON.parse(row.meta) as Record<string, unknown>;
  return message;
};

const asPlay = (row: PlayRow): PlayEvent => ({
  ts: row.ts,
  songId: row.song_id,
  title: row.title,
  artist: row.artist,
  source: row.source,
  level: row.level as QualityLevel,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  skipped: row.skipped === 1,
  reason: row.reason,
});

const asPlan = (row: PlanRow): DayPlan => ({
  date: row.date,
  createdAt: row.created_at,
  blocks: JSON.parse(row.blocks) as DayPlan['blocks'],
  active: row.active === 1,
});

/**
 * 语义上与 mock/server.mjs 的记账**逐条对齐**（同一组契约测试会两边都打）：
 * - 一条播放记录 = 一次 started；`endedAt === null` 就是 started，`endedAt !== null` 就是收尾。
 * - 同一首再 started 算一次重播（replay 在**写入时**算，不看调用方）。
 * - endedAt 收尾时找**最近一条**还没收尾的同曲记录；找不到就丢弃（重复上报不该凭空造一条）。
 * - 列表一律倒序（最新在前）；limit 越界夹住（非法 → 默认 50），因为错误码是封闭枚举。
 */
export class SqliteStore implements Store {
  private readonly db: SqliteDatabase;
  private readonly clock: Clock;
  private readonly warn: (message: string) => void;

  constructor(db: SqliteDatabase, clock: Clock, warn: (message: string) => void = () => {}) {
    this.db = db;
    this.clock = clock;
    this.warn = warn;
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    let current = row === undefined ? 0 : Number(row.user_version);
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(migration.sql);
        this.db.exec('PRAGMA user_version = ' + migration.version);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      current = migration.version;
    }
  }

  async appendMessage(m: DjMessage): Promise<void> {
    this.db.prepare('INSERT INTO messages (id, ts, role, text, meta) VALUES (?, ?, ?, ?, ?)')
      .run(m.id, m.ts, m.role, m.text, m.meta === undefined ? null : JSON.stringify(m.meta));
  }

  async recentMessages(limit: number): Promise<DjMessage[]> {
    const rows = this.db
      .prepare('SELECT id, ts, role, text, meta FROM messages ORDER BY ts DESC, rowid DESC LIMIT ?')
      .all(clampLimit(limit, 50)) as MessageRow[];
    return rows.map(asMessage);
  }

  async recordPlay(p: PlayEvent): Promise<void> {
    if (p.endedAt === null) {
      const prior = this.db.prepare('SELECT COUNT(*) AS n FROM plays WHERE song_id = ?').get(p.songId) as CountRow;
      this.db.prepare(
        'INSERT INTO plays (ts, song_id, title, artist, source, level, started_at, ended_at, skipped, reason, replay)'
        + ' VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)',
      ).run(p.ts, p.songId, p.title, p.artist, p.source, p.level, p.startedAt, p.reason, prior.n > 0 ? 1 : 0);
      return;
    }
    const open = this.db
      .prepare('SELECT id FROM plays WHERE song_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1')
      .get(p.songId) as { id: number } | undefined;
    if (open === undefined) return;
    this.db.prepare('UPDATE plays SET ended_at = ?, skipped = ? WHERE id = ?')
      .run(p.endedAt, p.skipped ? 1 : 0, open.id);
  }

  async recentPlays(limit: number): Promise<PlayEvent[]> {
    const rows = this.db
      .prepare(
        'SELECT ts, song_id, title, artist, source, level, started_at, ended_at, skipped, reason'
        + ' FROM plays ORDER BY ts DESC, id DESC LIMIT ?',
      )
      .all(clampLimit(limit, 50)) as PlayRow[];
    return rows.map(asPlay);
  }

  async playStats(since: Date): Promise<PlayStats> {
    const from = since.toISOString();
    const totals = this.db
      .prepare('SELECT COUNT(*) AS n, SUM(skipped) AS skipped, SUM(replay) AS replays FROM plays WHERE ts >= ?')
      .get(from) as { n: number; skipped: number | null; replays: number | null };
    // 必须自己造普通对象：驱动返回的行是 null 原型，直接往上传会让 deepStrictEqual 把两个实现判成不同。
    const topArtists = (this.db
      .prepare(
        'SELECT artist, COUNT(*) AS count FROM plays WHERE ts >= ?'
        + ' GROUP BY artist ORDER BY count DESC, artist ASC LIMIT 5',
      )
      .all(from) as { artist: string; count: number }[]).map((row) => ({ artist: row.artist, count: Number(row.count) }));
    return {
      played: Number(totals.n),
      skipped: Number(totals.skipped ?? 0),
      replays: Number(totals.replays ?? 0),
      topArtists,
    };
  }

  async savePlan(p: DayPlan): Promise<void> {
    this.db.prepare(
      'INSERT INTO plans (date, created_at, blocks, active) VALUES (?, ?, ?, ?)'
      + ' ON CONFLICT(date) DO UPDATE SET created_at = excluded.created_at, blocks = excluded.blocks, active = excluded.active',
    ).run(p.date, p.createdAt, JSON.stringify(p.blocks), p.active ? 1 : 0);
  }

  async activePlan(date: string): Promise<DayPlan | null> {
    const row = this.db.prepare('SELECT date, created_at, blocks, active FROM plans WHERE date = ?').get(date) as PlanRow | undefined;
    return row === undefined ? null : asPlan(row);
  }

  async favorites(): Promise<TrackRef[]> {
    const rows = this.db
      .prepare('SELECT song_id, title, artist FROM favorites ORDER BY added_at ASC, rowid ASC')
      .all() as FavoriteRow[];
    return rows.map((row) => ({ id: row.song_id, title: row.title, artist: row.artist }));
  }

  async setFavorite(track: TrackRef, liked: boolean): Promise<void> {
    if (!liked) {
      this.db.prepare('DELETE FROM favorites WHERE song_id = ?').run(track.id);
      return;
    }
    // 已经是喜欢就什么都不做：并发/重试下的幂等靠「保留第一次的 added_at」。
    this.db.prepare('INSERT OR IGNORE INTO favorites (song_id, title, artist, added_at) VALUES (?, ?, ?, ?)')
      .run(track.id, track.title, track.artist, this.clock.now().toISOString());
  }

  async getPref<K extends PrefKey>(key: K): Promise<PrefMap[K] | null> {
    if (!isPrefKey(key)) return null;
    const row = this.db.prepare('SELECT value FROM prefs WHERE key = ?').get(key) as PrefRow | undefined;
    return parsePref(key, row === undefined ? null : row.value, this.warn);
  }

  async setPref<K extends PrefKey>(key: K, value: PrefMap[K]): Promise<void> {
    this.db.prepare('INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  async appendTasteUpdate(u: TasteUpdate): Promise<void> {
    this.db.prepare('INSERT INTO taste_updates (ts, text, evidence) VALUES (?, ?, ?)')
      .run(u.ts, u.text, JSON.stringify(u.evidence));
  }

  async recentTasteUpdates(limit: number): Promise<TasteUpdate[]> {
    const rows = this.db
      .prepare('SELECT ts, text, evidence FROM taste_updates ORDER BY ts DESC, id DESC LIMIT ?')
      .all(clampLimit(limit, 20)) as TasteRow[];
    return rows.map((row) => ({ ts: row.ts, text: row.text, evidence: JSON.parse(row.evidence) as Record<string, unknown> }));
  }
}

/** 越界夹住、非法回默认：错误码是封闭枚举，里面没有「参数不合法」这种码。 */
function clampLimit(raw: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.trunc(raw));
}