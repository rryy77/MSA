import { NextResponse } from "next/server";

export function supabaseNotConfiguredResponse() {
  return NextResponse.json(
    {
      error: "supabase_not_configured",
      message:
        ".env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください（Supabase ダッシュボード → Project Settings → API）。",
    },
    { status: 503 },
  );
}
