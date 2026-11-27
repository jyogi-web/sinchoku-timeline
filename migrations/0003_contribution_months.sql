-- /ranking の草の日数を月ごとに保存する（docs/spec.md §6.1, §7.3）
-- 終わった月の数は一度取ったら使い回し、毎回 GitHub に問い合わせるのは今月の分だけにする

CREATE TABLE contribution_months (
  github_id  INTEGER NOT NULL, -- users.github_id（GitHub 名が変わっても使い回せるよう ID で持つ）
  month      TEXT    NOT NULL, -- "2026-11"（UTC）
  green_days INTEGER NOT NULL, -- その月に草が生えた日数
  fetched_at INTEGER NOT NULL, -- 取得した時刻。その月が終わる前に取ったものは、月が変わったら取り直す
  PRIMARY KEY (github_id, month)
);
