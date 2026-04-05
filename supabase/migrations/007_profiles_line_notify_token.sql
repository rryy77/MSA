-- LINE Notify トークン（ユーザーが設定画面で貼り付け）。サーバーから送信時のみ読む。

alter table public.profiles
  add column if not exists line_notify_token text;

comment on column public.profiles.line_notify_token is
  'LINE Notify のパーソナルアクセストークン（任意・メール受信の代替通知用）';
