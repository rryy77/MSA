import { NextResponse } from "next/server";
import { isLineMessagingPushEnvConfigured } from "@/lib/lineMessagingPush";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const loginConfigured = Boolean(
    process.env.LINE_CHANNEL_ID?.trim() && process.env.LINE_CHANNEL_SECRET?.trim(),
  );
  const pushConfigured = isLineMessagingPushEnvConfigured();

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      {
        connected: false,
        loginConfigured,
        pushConfigured,
        loggedIn: false,
      },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({
      connected: false,
      loginConfigured,
      pushConfigured,
      loggedIn: false,
    });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("line_messaging_user_id")
    .eq("id", user.id)
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
