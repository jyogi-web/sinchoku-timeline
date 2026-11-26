/**
 * D1 へのアクセス（docs/spec.md §7）
 */

export interface UserRow {
  discord_user_id: string;
  github_login: string;
  github_id: number;
  push_enabled: number; // 0 / 1
  etag: string | null;
  seen_event_ids: string | null; // 前回取得したイベント ID の JSON 配列。null = 登録直後
  last_polled_at: number | null;
  created_at: number;
  updated_at: number;
}

// ---- users ----

export function getUser(db: D1Database, discordUserId: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE discord_user_id = ?").bind(discordUserId).first<UserRow>();
}

export function getUserByGithubId(db: D1Database, githubId: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE github_id = ?").bind(githubId).first<UserRow>();
}

export async function insertUser(db: D1Database, discordUserId: string, githubLogin: string, githubId: number, now: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO users (discord_user_id, github_login, github_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(discordUserId, githubLogin, githubId, now, now)
    .run();
}

/** GitHub アカウントを変更する。ETag と見たイベント ID の一覧をリセットし「登録直後」と同じ扱いにする（push 設定は引き継ぐ） */
export async function changeGithub(db: D1Database, discordUserId: string, githubLogin: string, githubId: number, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE users
         SET github_login = ?, github_id = ?, etag = NULL, seen_event_ids = NULL, last_polled_at = NULL, updated_at = ?
       WHERE discord_user_id = ?`,
    )
    .bind(githubLogin, githubId, now, discordUserId)
    .run();
}

/** GitHub 側でユーザー名だけが変わった場合に、表示用の名前を追従させる */
export async function updateGithubLogin(db: D1Database, discordUserId: string, githubLogin: string, now: number): Promise<void> {
  await db
    .prepare("UPDATE users SET github_login = ?, updated_at = ? WHERE discord_user_id = ?")
    .bind(githubLogin, now, discordUserId)
    .run();
}

export async function deleteUser(db: D1Database, discordUserId: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM users WHERE discord_user_id = ?").bind(discordUserId).run();
  return r.meta.changes > 0;
}

export async function setPushEnabled(db: D1Database, discordUserId: string, enabled: boolean, now: number): Promise<boolean> {
  const r = await db
    .prepare("UPDATE users SET push_enabled = ?, updated_at = ? WHERE discord_user_id = ?")
    .bind(enabled ? 1 : 0, now, discordUserId)
    .run();
  return r.meta.changes > 0;
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const r = await db.prepare("SELECT * FROM users ORDER BY created_at").all<UserRow>();
  return r.results;
}

/** ポーリングの順番：最後に確認した時刻が古い人から（未確認の人が最優先） */
export async function listUsersForPolling(db: D1Database): Promise<UserRow[]> {
  const r = await db
    .prepare("SELECT * FROM users ORDER BY last_polled_at IS NOT NULL, last_polled_at")
    .all<UserRow>();
  return r.results;
}

export async function savePollState(
  db: D1Database,
  discordUserId: string,
  state: { etag: string | null; seenEventIds: string | null; lastPolledAt: number | null },
): Promise<void> {
  await db
    .prepare("UPDATE users SET etag = ?, seen_event_ids = ?, last_polled_at = ? WHERE discord_user_id = ?")
    .bind(state.etag, state.seenEventIds, state.lastPolledAt, discordUserId)
    .run();
}

// ---- settings ----

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export const SETTING_CHANNEL_ID = "channel_id";
