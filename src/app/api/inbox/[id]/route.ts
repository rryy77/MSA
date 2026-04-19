import { NextResponse } from "next/server";
import { getMsaAuth } from "@/lib/msaApiAuth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: { read?: boolean };
  try {
    body = (await req.json()) as { read?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.read !== true) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const { error } = await service
    .from("invite_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("recipient_user_id", auth.ok.msa.uid);

  if (error) {
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
