import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

function supabaseProjectUrl(): string | undefined {
  const a = process.env.SUPABASE_URL?.trim();
  const b = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  return a || b || undefined;
}

/** サーバー専用。RLS をバイパスして他ユーザーの行を読む場合のみ（例: Web Push 送信）。 */
export function createServiceRoleClient(): SupabaseClient | null {
  const url = supabaseProjectUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
