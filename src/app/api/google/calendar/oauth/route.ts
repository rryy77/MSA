import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getGoogleOAuthClientOrNull, isGoogleCalendarOAuthConfigured } from "@/lib/googleCalendarOAuth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  if (!isGoogleCalendarOAuthConfigured()) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 503 });
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const base = getAppBaseUrl();
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent("/settings")}`, base),
    );
  }

  const oauth2 = getGoogleOAuthClientOrNull();
  if (!oauth2) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 503 });
  }

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    prompt: "consent",
    include_granted_scopes: true,
    state: user.id,
  });

  return NextResponse.redirect(url);
}
