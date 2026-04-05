import { NextResponse } from "next/server";
import { supabaseNotConfiguredResponse } from "@/lib/supabase/api";
import { createClient } from "@/lib/supabase/server";

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
    .from("invite_notifications")
    .select(
      "id, session_id, subject, invite_url, created_at, read_at, text_body, html_body",
    )
    .eq("recipient_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "inbox_fetch_failed", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ items: data ?? [] });
}
