import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/appUrl";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const base = getAppBaseUrl().replace(/\/$/, "");
  const settingsUrl = new URL("/settings", base);

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", err);
    return NextResponse.redirect(settingsUrl);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expected = cookieStore.get("line_oauth_state")?.value;
  cookieStore.delete("line_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login", base));
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
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "line_channel_not_configured");
    return NextResponse.redirect(settingsUrl);
  }

  const redirectUri = `${base}/api/line/callback`;

  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    console.error("line oauth token", t);
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "token_exchange");
    return NextResponse.redirect(settingsUrl);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "no_access_token");
    return NextResponse.redirect(settingsUrl);
  }

  const profileRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });

  if (!profileRes.ok) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "profile_fetch");
    return NextResponse.redirect(settingsUrl);
  }

  const profile = (await profileRes.json()) as { userId?: string };
  if (!profile.userId) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "no_line_user_id");
    return NextResponse.redirect(settingsUrl);
  }

  const { error: upErr } = await supabase
    .from("profiles")
    .update({
      line_messaging_user_id: profile.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (upErr) {
    console.error("line profile save", upErr);
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "save_failed");
    return NextResponse.redirect(settingsUrl);
  }

  settingsUrl.searchParams.set("line", "connected");
  return NextResponse.redirect(settingsUrl);
}
