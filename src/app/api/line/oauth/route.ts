import { NextResponse } from "next/server";
import { getLineOAuthClientCredentials } from "@/lib/lineOAuthCredentials";
import {
  LINE_OAUTH_REDIRECT_COOKIE,
  getLineOAuthRedirectUriForRequest,
} from "@/lib/lineOAuthRedirect";
import { getOriginFromRequest } from "@/lib/requestOrigin";
import { getMsaAuth } from "@/lib/msaApiAuth";

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 600,
  path: "/",
};

export async function GET(request: Request) {
  const baseFallback = getOriginFromRequest(request);
  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  const { clientId: channelId, clientSecret: channelSecret } =
    getLineOAuthClientCredentials();
  if (!channelId || !channelSecret) {
    return NextResponse.redirect(
      new URL("/settings?line=error&reason=line_channel_not_configured", baseFallback),
    );
  }

  const redirectUri = getLineOAuthRedirectUriForRequest(request);

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid",
    nonce,
  });

  const res = NextResponse.redirect(
    `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`,
  );
  res.cookies.set("line_oauth_state", state, cookieOpts);
  res.cookies.set(LINE_OAUTH_REDIRECT_COOKIE, redirectUri, cookieOpts);
  return res;
}
