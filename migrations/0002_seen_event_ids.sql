-- 重複判定を「イベント ID の大小」から「前回見たイベント ID の一覧」に変更する（docs/spec.md §5）
-- イベント ID はイベントの種類によって番号の範囲が異なり、新しいほど大きいとは限らないため

ALTER TABLE users ADD COLUMN seen_event_ids TEXT; -- 前回取得したイベント ID の JSON 配列。NULL = 登録直後
ALTER TABLE users DROP COLUMN last_event_id;
