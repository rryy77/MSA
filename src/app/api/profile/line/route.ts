import { NextResponse } from "next/server";
import { supabaseNotConfiguredResponse } from "@/lib/supabase/api";
import { createClient } from "@/lib/supabase/server";

/** LINE Messaging 連携を解除（line_messaging_user_id を削除） */
export async function PATCH(req: Request) {
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

  let body: { disconnect?: boolean };
  try {
    body = (await req.json()) as { disconnect?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.disconnect !== true) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      line_messaging_user_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, connected: false });
}
