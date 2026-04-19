import { NextResponse } from "next/server";
import { getMsaAuth } from "@/lib/msaApiAuth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  await service
    .from("invite_notifications")
    .delete()
    .eq("recipient_user_id", auth.ok.msa.uid)
    .lt("expires_at", nowIso);

  const { data, error } = await service
    .from("invite_notifications")
    .select(
      "id, session_id, subject, invite_url, created_at, read_at, text_body, html_body",
    )
    .eq("recipient_user_id", auth.ok.msa.uid)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "inbox_fetch_failed", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ items: data ?? [] });
}
