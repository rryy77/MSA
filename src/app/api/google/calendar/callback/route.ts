import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getGoogleOAuthClientOrNull } from "@/lib/googleCalendarOAuth";
import {
  fetchGoogleCalendarRefreshToken,
  updateGoogleCalendarRefreshToken,
} from "@/lib/inviteInbox";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const base = getAppBaseUrl();
  const settingsUrl = new URL("/settings", base);

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", err);
    return NextResponse.redirect(settingsUrl);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login", base));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent("/settings")}`, base),
    );
  }

  const oauth2 = getGoogleOAuthClientOrNull();
  if (!oauth2) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "oauth_not_configured");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    const existing = await fetchGoogleCalendarRefreshToken(supabase, user.id);
    const refresh = tokens.refresh_token ?? existing ?? null;
    if (!refresh) {
      settingsUrl.searchParams.set("calendar", "no_refresh");
      return NextResponse.redirect(settingsUrl);
    }
    await updateGoogleCalendarRefreshToken(supabase, user.id, refresh);
  } catch (e) {
    console.error("google calendar callback", e);
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set(
      "reason",
      e instanceof Error ? e.message.slice(0, 80) : "token_exchange",
    );
    return NextResponse.redirect(settingsUrl);
  }

  settingsUrl.searchParams.set("calendar", "connected");
  return NextResponse.redirect(settingsUrl);
}
