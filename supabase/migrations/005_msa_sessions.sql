-- MSA 日程セッション（Vercel 等サーバーレスではローカルファイルが使えないため DB に保存）
-- API Route は SUPABASE_SERVICE_ROLE_KEY で読み書き（RLS は anon/認証ユーザーからはアクセス不可）

create table if not exists public.msa_sessions (
  id text primary key,
  organizer_user_id uuid references auth.users(id) on delete set null,
  participant_token text not null,
  body jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists msa_sessions_organizer_user_id_idx
  on public.msa_sessions(organizer_user_id);

create unique index if not exists msa_sessions_participant_token_key
  on public.msa_sessions(participant_token);

alter table public.msa_sessions enable row level security;

comment on table public.msa_sessions is 'MSA 日程調整（サーバー API のみ service_role でアクセス）';
