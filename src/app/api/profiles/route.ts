import { NextResponse } from "next/server";
import { supabaseNotConfiguredResponse } from "@/lib/supabase/api";
import { createClient } from "@/lib/supabase/server";

/** 参加者指定用: 自分以外の登録ユーザー一覧（メール・表示名） */
export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return supabaseNotConfiguredResponse();
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .neq("id", user.id)
    .order("email", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "profiles_fetch_failed", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ profiles: data ?? [] });
}
