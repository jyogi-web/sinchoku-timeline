-- docs/spec.md §7 データの持ち方

-- 登録者 1 人につき 1 行
CREATE TABLE users (
  discord_user_id TEXT PRIMARY KEY,
  github_login    TEXT    NOT NULL,
  github_id       INTEGER NOT NULL UNIQUE,  -- 同じ GitHub アカウントの重複登録は不可
  push_enabled    INTEGER NOT NULL DEFAULT 0,
  etag            TEXT,                     -- 前回の Events API レスポンスの ETag
  last_event_id   TEXT,                     -- 最後に処理したイベント ID。NULL = 登録直後
  last_polled_at  INTEGER,                  -- 最後に確認した時刻（UNIX ミリ秒）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- 確認が古い人から処理するための索引
CREATE INDEX idx_users_last_polled_at ON users (last_polled_at);

-- Bot 全体の設定（MVP では channel_id のみ）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
