/**
 * D1 へのアクセス（docs/spec.md §7）
 */

export interface UserRow {
  discord_user_id: string;
  github_login: string;
  github_id: number;
  push_enabled: number; // 0 / 1
  star_enabled: number; // 0 / 1（初期値は1）
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

/** 登録を消す。その人の草の日数（contribution_months）も一緒に消す */
export async function deleteUser(db: D1Database, discordUserId: string): Promise<boolean> {
  const [, r] = await db.batch([
    db
      .prepare("DELETE FROM contribution_months WHERE github_id = (SELECT github_id FROM users WHERE discord_user_id = ?)")
      .bind(discordUserId),
    db.prepare("DELETE FROM users WHERE discord_user_id = ?").bind(discordUserId),
  ]);
  return r.meta.changes > 0;
}

export async function setPushEnabled(db: D1Database, discordUserId: string, enabled: boolean, now: number): Promise<boolean> {
  const r = await db
    .prepare("UPDATE users SET push_enabled = ?, updated_at = ? WHERE discord_user_id = ?")
    .bind(enabled ? 1 : 0, now, discordUserId)
    .run();
  return r.meta.changes > 0;
}

export async function setStarEnabled(db: D1Database, discordUserId: string, enabled: boolean, now: number): Promise<boolean> {
  const r = await db
    .prepare("UPDATE users SET star_enabled = ?, updated_at = ? WHERE discord_user_id = ?")
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

// ---- contribution_months（/ranking の草の日数） ----

export interface ContributionMonthRow {
  github_id: number;
  month: string; // "2026-11"
  green_days: number;
  fetched_at: number;
}

/** 保存してある月ごとの草の日数（登録者が少ないので全件取る） */
export async function listContributionMonths(db: D1Database): Promise<ContributionMonthRow[]> {
  const r = await db.prepare("SELECT * FROM contribution_months").all<ContributionMonthRow>();
  return r.results;
}

export async function saveContributionMonths(db: D1Database, rows: ContributionMonthRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO contribution_months (github_id, month, green_days, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (github_id, month) DO UPDATE SET green_days = excluded.green_days, fetched_at = excluded.fetched_at`,
  );
  await db.batch(rows.map((r) => stmt.bind(r.github_id, r.month, r.green_days, r.fetched_at)));
}

/** GitHub アカウントを変えたときに、前のアカウントの分を消す */
export async function deleteContributionMonths(db: D1Database, githubId: number): Promise<void> {
  await db.prepare("DELETE FROM contribution_months WHERE github_id = ?").bind(githubId).run();
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
