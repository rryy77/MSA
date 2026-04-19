import { NextResponse } from "next/server";
import { fetchGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import {
  getGoogleCalendarRedirectUriForRequest,
  isGoogleCalendarOAuthConfigured,
} from "@/lib/googleCalendarOAuth";
import { getMsaAuth } from "@/lib/msaApiAuth";

export async function GET(request: Request) {
  const oauthConfigured = isGoogleCalendarOAuthConfigured();
  /** Google OAuth の「承認済みのリダイレクト URI」と一字一句合わせる値（400 redirect_uri_mismatch 対策） */
  const oauthRedirectUri = oauthConfigured
    ? getGoogleCalendarRedirectUriForRequest(request)
    : null;

  const auth = await getMsaAuth();
  if ("error" in auth) {
    return NextResponse.json({
      connected: false,
      oauthConfigured,
      loggedIn: false,
      oauthRedirectUri,
    });
  }

  const { msa } = auth.ok;
  const token = oauthConfigured ? await fetchGoogleCalendarRefreshToken(msa.uid) : null;

  return NextResponse.json({
    connected: Boolean(token),
    oauthConfigured,
    loggedIn: true,
    role: msa.role,
    oauthRedirectUri,
  });
}
