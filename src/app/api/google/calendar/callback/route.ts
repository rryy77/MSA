import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getGoogleCalendarRedirectUriForRequest,
  getGoogleOAuthClientForRedirect,
  getPublicBaseUrlFromRequest,
} from "@/lib/googleCalendarOAuth";
import {
  fetchGoogleCalendarRefreshToken,
  updateGoogleCalendarRefreshToken,
} from "@/lib/inviteInbox";
import { getMsaConfig } from "@/lib/msaConfig";
import { getMsaSessionFromCookies } from "@/lib/msaSession";

export async function GET(request: Request) {
  const base = getPublicBaseUrlFromRequest(request);
  const settingsUrl = new URL("/settings", base);

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", err);
    const desc = url.searchParams.get("error_description");
    if (desc) {
      settingsUrl.searchParams.set("detail", desc.slice(0, 500));
    }
    return NextResponse.redirect(settingsUrl);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  let cfg;
  try {
    cfg = getMsaConfig();
  } catch {
    return NextResponse.redirect(new URL("/login", base));
  }

  if (state !== cfg.organizerId) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "state_mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  const msa = getMsaSessionFromCookies(await cookies());
  if (!msa || msa.role !== "organizer" || msa.uid !== cfg.organizerId) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent("/settings")}`, base),
    );
  }

  const redirectUri = getGoogleCalendarRedirectUriForRequest(request);
  const oauth2 = getGoogleOAuthClientForRedirect(redirectUri);
  if (!oauth2) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "oauth_not_configured");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    const existing = await fetchGoogleCalendarRefreshToken(msa.uid);
    const refresh = tokens.refresh_token ?? existing ?? null;
    if (!refresh) {
      settingsUrl.searchParams.set("calendar", "no_refresh");
      return NextResponse.redirect(settingsUrl);
    }
    await updateGoogleCalendarRefreshToken(msa.uid, refresh);
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
