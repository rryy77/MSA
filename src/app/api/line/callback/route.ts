import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLineOAuthClientCredentials } from "@/lib/lineOAuthCredentials";
import {
  LINE_OAUTH_REDIRECT_COOKIE,
  getLineOAuthRedirectUriForRequest,
  isSafeLineOAuthRedirectUri,
} from "@/lib/lineOAuthRedirect";
import { getOriginFromRequest } from "@/lib/requestOrigin";
import { getMsaSessionFromCookies } from "@/lib/msaSession";
import { createServiceRoleClient } from "@/lib/supabase/service";

function lineOAuthRedirect(to: URL) {
  const res = NextResponse.redirect(to);
  res.cookies.delete("line_oauth_state");
  res.cookies.delete(LINE_OAUTH_REDIRECT_COOKIE);
  return res;
}

export async function GET(request: Request) {
  const fallbackOrigin = getOriginFromRequest(request).replace(/\/$/, "");
  const fallbackSettings = new URL("/settings", fallbackOrigin);

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) {
    fallbackSettings.searchParams.set("line", "error");
    fallbackSettings.searchParams.set("reason", err);
    return lineOAuthRedirect(fallbackSettings);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expected = cookieStore.get("line_oauth_state")?.value;
  const storedRedirect = cookieStore.get(LINE_OAUTH_REDIRECT_COOKIE)?.value;

  const redirectUri =
    storedRedirect && isSafeLineOAuthRedirectUri(storedRedirect)
      ? storedRedirect
      : getLineOAuthRedirectUriForRequest(request);

  const settingsOrigin = new URL(redirectUri).origin;
  const settingsUrl = new URL("/settings", settingsOrigin);

  if (!code || !state || !expected || state !== expected) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "state_mismatch");
    return lineOAuthRedirect(settingsUrl);
  }

  const msa = getMsaSessionFromCookies(cookieStore);
  if (!msa) {
    return lineOAuthRedirect(
      new URL(`/login?next=${encodeURIComponent("/settings")}`, settingsOrigin),
    );
  }

  const { clientId: channelId, clientSecret: channelSecret } =
    getLineOAuthClientCredentials();
  if (!channelId || !channelSecret) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "line_channel_not_configured");
    return lineOAuthRedirect(settingsUrl);
  }

  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    console.error("line oauth token", t);
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "token_exchange");
    return lineOAuthRedirect(settingsUrl);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "no_access_token");
    return lineOAuthRedirect(settingsUrl);
  }

  const profileRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });

  if (!profileRes.ok) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "profile_fetch");
    return lineOAuthRedirect(settingsUrl);
  }

  const profile = (await profileRes.json()) as { userId?: string };
  if (!profile.userId) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "no_line_user_id");
    return lineOAuthRedirect(settingsUrl);
  }

  const service = createServiceRoleClient();
  if (!service) {
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "supabase");
    return lineOAuthRedirect(settingsUrl);
  }

  const { error: upErr } = await service
    .from("profiles")
    .update({
      line_messaging_user_id: profile.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", msa.uid);

  if (upErr) {
    console.error("line profile save", upErr);
    settingsUrl.searchParams.set("line", "error");
    settingsUrl.searchParams.set("reason", "save_failed");
    return lineOAuthRedirect(settingsUrl);
  }

  settingsUrl.searchParams.set("line", "connected");
  return lineOAuthRedirect(settingsUrl);
}
