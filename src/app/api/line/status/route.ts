import { NextResponse } from "next/server";
import { isLineMessagingPushEnvConfigured } from "@/lib/lineMessagingPush";
import { getMsaAuth } from "@/lib/msaApiAuth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET() {
  const loginConfigured = Boolean(
    process.env.LINE_CHANNEL_ID?.trim() && process.env.LINE_CHANNEL_SECRET?.trim(),
  );
  const pushConfigured = isLineMessagingPushEnvConfigured();

  const auth = await getMsaAuth();
  if ("error" in auth) {
    return NextResponse.json({
      connected: false,
      loginConfigured,
      pushConfigured,
      loggedIn: false,
    });
  }

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json(
      { connected: false, loginConfigured, pushConfigured, loggedIn: true },
      { status: 503 },
    );
  }

  const { data, error } = await service
    .from("profiles")
    .select("line_messaging_user_id")
    .eq("id", auth.ok.msa.uid)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "fetch_failed", detail: error.message },
      { status: 502 },
    );
  }

  const t = data?.line_messaging_user_id;
  const connected = typeof t === "string" && t.trim().length > 0;

  return NextResponse.json({
    connected,
    loginConfigured,
    pushConfigured,
    loggedIn: true,
  });
}
