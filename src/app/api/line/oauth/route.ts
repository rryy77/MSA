import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/appUrl";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const base = getAppBaseUrl();
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/settings?line=error&reason=supabase", base));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent("/settings")}`, base),
    );
  }

  const channelId = process.env.LINE_CHANNEL_ID?.trim();
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!channelId || !channelSecret) {
    return NextResponse.redirect(
      new URL("/settings?line=error&reason=line_channel_not_configured", base),
    );
  }

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("line_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  const redirectUri = `${base.replace(/\/$/, "")}/api/line/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid",
    nonce,
  });

  return NextResponse.redirect(
    `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`,
  );
}
