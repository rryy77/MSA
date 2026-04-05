import { NextResponse } from "next/server";
import { fetchGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import { isGoogleCalendarOAuthConfigured } from "@/lib/googleCalendarOAuth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const oauthConfigured = isGoogleCalendarOAuthConfigured();

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { connected: false, oauthConfigured, loggedIn: false },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({
      connected: false,
      oauthConfigured,
      loggedIn: false,
    });
  }

  const token = oauthConfigured
    ? await fetchGoogleCalendarRefreshToken(supabase, user.id)
    : null;

  return NextResponse.json({
    connected: Boolean(token),
    oauthConfigured,
    loggedIn: true,
  });
}
