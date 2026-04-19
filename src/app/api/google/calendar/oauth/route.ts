import { NextResponse } from "next/server";
import {
  GCAL_OAUTH_REDIRECT_COOKIE,
  getGoogleCalendarRedirectUriForRequest,
  getGoogleOAuthClientForRedirect,
  isGoogleCalendarOAuthConfigured,
} from "@/lib/googleCalendarOAuth";
import { requireMsaOrganizer } from "@/lib/msaApiAuth";

export async function GET(request: Request) {
  if (!isGoogleCalendarOAuthConfigured()) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 503 });
  }

  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;

  const redirectUri = getGoogleCalendarRedirectUriForRequest(request);
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim()) {
    console.info("[google-calendar-oauth] redirect_uri from GOOGLE_CALENDAR_REDIRECT_URI env");
  } else {
    console.info("[google-calendar-oauth] redirect_uri:", redirectUri);
  }
  const oauth2 = getGoogleOAuthClientForRedirect(redirectUri);
  if (!oauth2) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 503 });
  }

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    /** その都度アカウントを選べるようにする（テストユーザー固定で進まない） */
    prompt: "consent select_account",
    include_granted_scopes: true,
    state: auth.ok.cfg.organizerId,
  });

  /** コールバックは Google からの GET でヘッダが変わることがあるため、getToken に同じ redirect_uri を渡す */
  const res = NextResponse.redirect(url);
  res.cookies.set(GCAL_OAUTH_REDIRECT_COOKIE, redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
