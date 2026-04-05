-- LINE Messaging API 用。LINE Notify のトークン列とは別（LINE Developers で Login + Messaging を利用）。

alter table public.profiles
  add column if not exists line_messaging_user_id text;

comment on column public.profiles.line_messaging_user_id is
  'LINE Messaging API の userId（LINE Login 連携で取得。push 送信先）';
