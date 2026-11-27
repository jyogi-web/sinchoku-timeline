-- スター通知のオンオフ（issue #2）。既存の登録者もオンになる
ALTER TABLE users ADD COLUMN star_enabled INTEGER NOT NULL DEFAULT 1;
