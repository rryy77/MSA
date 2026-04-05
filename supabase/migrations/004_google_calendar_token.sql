-- Google カレンダー連携用（OAuth refresh token）。本人のみ更新可（既存 RLS）。

alter table public.profiles
  add column if not exists google_calendar_refresh_token text;

comment on column public.profiles.google_calendar_refresh_token is
  'Google Calendar API 用 OAuth refresh token（サーバーからのみ利用推奨）';
