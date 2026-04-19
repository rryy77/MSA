-- 受信トレイ: 予定日時を過ぎた通知を自動削除するための期限
alter table public.invite_notifications
  add column if not exists expires_at timestamptz;

create index if not exists invite_notifications_expires_at_idx
  on public.invite_notifications (expires_at)
  where expires_at is not null;
