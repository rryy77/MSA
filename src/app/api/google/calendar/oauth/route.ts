import { NextResponse } from "next/server";
import { getGoogleOAuthClientOrNull, isGoogleCalendarOAuthConfigured } from "@/lib/googleCalendarOAuth";
import { requireMsaOrganizer } from "@/lib/msaApiAuth";

export async function GET() {
  if (!isGoogleCalendarOAuthConfigured()) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 503 });
  }

  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;

  const oauth2 = getGoogleOAuthClientOrNull();
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

  return NextResponse.redirect(url);
}
