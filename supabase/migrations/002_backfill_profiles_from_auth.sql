-- auth.users にだけいて public.profiles に行がないユーザー用（トリガー追加前のユーザーなど）
-- Supabase SQL Editor または supabase db push で実行可。何度実行しても安全。

insert into public.profiles (id, email, full_name, avatar_url)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  u.raw_user_meta_data->>'avatar_url'
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;
