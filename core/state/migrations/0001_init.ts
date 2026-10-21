export const SQL_0001 = String.raw`
-- 0001_init：六张表（抽象层第 4 节）。
-- 为什么是 TS 里的字符串而不是 .sql 文件：打包成 exe 时 core/ 会被打成单文件，
-- 运行期没有 migrations/*.sql 可读。SQL 与它所属的版本号放在一起，反而更难漂移。

CREATE TABLE messages (
  id   TEXT PRIMARY KEY,
  ts   TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX idx_messages_ts ON messages (ts DESC);

-- 一条播放记录 = 一次 started。同一首再 started 算一次重播；ended / skipped 收尾同一条。
-- replay 是记账时算出来的（Store 自己算，不看调用方），因为 PlayEvent 里没有这个字段。
CREATE TABLE plays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL,
  song_id    TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  artist     TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  level      TEXT    NOT NULL,
  started_at TEXT    NOT NULL,
  ended_at   TEXT,
  skipped    INTEGER NOT NULL DEFAULT 0,
  reason     TEXT,
  replay     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_plays_ts ON plays (ts DESC);
CREATE INDEX idx_plays_open ON plays (song_id, ended_at);

-- 喜欢列表存 TrackRef 而不是 song_id：v1 没有 songs 表。
CREATE TABLE favorites (
  song_id  TEXT PRIMARY KEY,
  title    TEXT NOT NULL,
  artist   TEXT NOT NULL,
  added_at TEXT NOT NULL
);

-- 设置项。key 是封闭枚举；value 一律是字符串，parse 在读取侧。
CREATE TABLE prefs (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE plans (
  date       TEXT PRIMARY KEY,
  created_at TEXT    NOT NULL,
  blocks     TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0
);

-- ：系统学到的结构化更新，不回写人写的语料。
CREATE TABLE taste_updates (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  text     TEXT NOT NULL,
  evidence TEXT NOT NULL
);
CREATE INDEX idx_taste_ts ON taste_updates (ts DESC);
`;