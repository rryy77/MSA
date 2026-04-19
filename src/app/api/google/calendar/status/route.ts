import { NextResponse } from "next/server";
import { fetchGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import { isGoogleCalendarOAuthConfigured } from "@/lib/googleCalendarOAuth";
import { getMsaAuth } from "@/lib/msaApiAuth";

export async function GET() {
  const oauthConfigured = isGoogleCalendarOAuthConfigured();

  const auth = await getMsaAuth();
  if ("error" in auth) {
    return NextResponse.json({ connected: false, oauthConfigured, loggedIn: false });
  }

  const { msa } = auth.ok;
  const token = oauthConfigured ? await fetchGoogleCalendarRefreshToken(msa.uid) : null;

  return NextResponse.json({
    connected: Boolean(token),
    oauthConfigured,
    loggedIn: true,
    role: msa.role,
  });
}
