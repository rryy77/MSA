import { NextResponse } from "next/server";
import { getMsaAuth } from "@/lib/msaApiAuth";
import { createServiceRoleClient } from "@/lib/supabase/service";

type SubBody = {
  subscription?: {
    endpoint: string;
    keys?: { p256dh: string; auth: string };
  };
};

export async function POST(req: Request) {
  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  let body: SubBody;
  try {
    body = (await req.json()) as SubBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }

  const { error } = await service.from("push_subscriptions").upsert(
    {
      user_id: auth.ok.msa.uid,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  let body: { endpoint?: string };
  try {
    body = (await req.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.endpoint?.trim()) {
    return NextResponse.json({ error: "endpoint_required" }, { status: 400 });
  }

  const { error } = await service
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint)
    .eq("user_id", auth.ok.msa.uid);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
