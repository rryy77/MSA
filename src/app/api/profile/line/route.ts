import { NextResponse } from "next/server";
import { getMsaAuth } from "@/lib/msaApiAuth";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** LINE Messaging 連携を解除（line_messaging_user_id を削除） */
export async function PATCH(req: Request) {
  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  let body: { disconnect?: boolean };
  try {
    body = (await req.json()) as { disconnect?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.disconnect !== true) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const { error } = await service
    .from("profiles")
    .update({
      line_messaging_user_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.ok.msa.uid);

  if (error) {
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, connected: false });
}
