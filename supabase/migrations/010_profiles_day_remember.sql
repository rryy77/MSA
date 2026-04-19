-- DAYREMEMBER: Google カレンダーに追加した確定枠の曜日・時間帯を集計
alter table public.profiles
  add column if not exists day_remember jsonb default '{"entries":[]}'::jsonb;
