import { NextResponse } from "next/server";
import {
  encodeGoogleOAuthState,
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

  /** state に redirect_uri を署名付きで含める（Google 戻りで Cookie が無くても getToken が一致する） */
  const state = encodeGoogleOAuthState(auth.ok.cfg.organizerId, redirectUri);

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    prompt: "consent select_account",
    include_granted_scopes: true,
    state,
  });

  return NextResponse.redirect(url);
}
