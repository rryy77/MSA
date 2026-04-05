import type { Provider } from "@supabase/supabase-js";

/**
 * .env の `NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS`（カンマ区切り）で OAuth ボタンを出す。
 * 未設定なら OAuth は出さない（メール / マジックリンクのみ）→ ダッシュボードで未有効なプロバイダーを押して 400 にならない。
 * 各名前は Supabase Authentication → Providers で有効化が必要。
 */
export function getAuthOauthProviders(): Provider[] {
  const raw = process.env.NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS?.trim();
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as Provider[];
}
