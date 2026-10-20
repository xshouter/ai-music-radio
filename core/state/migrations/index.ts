import { SQL_0001 } from './0001_init.ts';

/**
 * 迁移是有序的：只往后加，不改已经发布过的那一条。
 * 版本号落在 SQLite 的 `PRAGMA user_version` 上，由 SqliteStore 负责推进 —— 不用自建 schema_version 表。
 */
export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  { version: 1, sql: SQL_0001 },
];