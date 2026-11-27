-- /ranking の PR 数と草を 1 日 1 回の Cron で取って保存する（docs/spec.md §6.1, §7.1）
-- /ranking のたびに GitHub に問い合わせるのをやめ、保存した値を読むだけにする

ALTER TABLE users ADD COLUMN prs INTEGER;                          -- 作成した PR の数。NULL = まだ取っていない
ALTER TABLE users ADD COLUMN contributions_synced_through TEXT;    -- 草をどの日まで数えたか（"2026-11-26"、UTC）。NULL = まだ数えていない
