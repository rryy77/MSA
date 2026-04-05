-- Run in Supabase SQL Editor (or supabase db push). Enables Google OAuth in Dashboard → Authentication → Providers.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.invite_notifications (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  organizer_user_id uuid references public.profiles (id) on delete set null,
  subject text not null,
  text_body text not null,
  html_body text not null,
  invite_url text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists invite_notifications_recipient_created_idx
  on public.invite_notifications (recipient_user_id, created_at desc);

alter table public.invite_notifications enable row level security;

create policy "invite_select_own"
  on public.invite_notifications for select
  to authenticated
  using (auth.uid() = recipient_user_id);

create policy "invite_update_read_own"
  on public.invite_notifications for update
  to authenticated
  using (auth.uid() = recipient_user_id)
  with check (auth.uid() = recipient_user_id);

create policy "invite_insert_as_organizer"
  on public.invite_notifications for insert
  to authenticated
  with check (auth.uid() = organizer_user_id);

-- 既に auth.users にだけ存在するユーザー向け（初回のみ手動実行してよい）
-- insert into public.profiles (id, email, full_name, avatar_url)
-- select id, email,
--   coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
--   raw_user_meta_data->>'avatar_url'
-- from auth.users
-- on conflict (id) do nothing;
