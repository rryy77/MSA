-- PostgREST / service_role から msa_sessions にアクセスできるよう明示付与（環境差の回避）
grant usage on schema public to service_role;
grant all on table public.msa_sessions to service_role;
