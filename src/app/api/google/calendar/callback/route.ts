import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  GCAL_OAUTH_REDIRECT_COOKIE,
  getGoogleCalendarRedirectUriForRequest,
  getGoogleOAuthClientForRedirect,
  getPublicBaseUrlFromRedirectUri,
  isSafeOAuthRedirectUri,
} from "@/lib/googleCalendarOAuth";
import {
  fetchGoogleCalendarRefreshToken,
  updateGoogleCalendarRefreshToken,
} from "@/lib/inviteInbox";
import { getMsaConfig } from "@/lib/msaConfig";
import { getMsaSessionFromCookies } from "@/lib/msaSession";

function redirectClearingCookie(url: string | URL): NextResponse {
  const res = NextResponse.redirect(url);
  res.cookies.set(GCAL_OAUTH_REDIRECT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const storedRu = cookieStore.get(GCAL_OAUTH_REDIRECT_COOKIE)?.value;
  const redirectUri =
    storedRu && isSafeOAuthRedirectUri(storedRu)
      ? storedRu
      : getGoogleCalendarRedirectUriForRequest(request);

  const base = getPublicBaseUrlFromRedirectUri(redirectUri);
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
    return redirectClearingCookie(settingsUrl);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "missing_code");
    return redirectClearingCookie(settingsUrl);
  }

  let cfg;
  try {
    cfg = getMsaConfig();
  } catch {
    return redirectClearingCookie(new URL("/login", base));
  }

  if (state !== cfg.organizerId) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "state_mismatch");
    return redirectClearingCookie(settingsUrl);
  }

  const msa = getMsaSessionFromCookies(cookieStore);
  if (!msa || msa.role !== "organizer" || msa.uid !== cfg.organizerId) {
    return redirectClearingCookie(
      new URL(`/login?next=${encodeURIComponent("/settings")}`, base),
    );
  }

  const oauth2 = getGoogleOAuthClientForRedirect(redirectUri);
  if (!oauth2) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "oauth_not_configured");
    return redirectClearingCookie(settingsUrl);
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    const existing = await fetchGoogleCalendarRefreshToken(msa.uid);
    const refresh = tokens.refresh_token ?? existing ?? null;
    if (!refresh) {
      settingsUrl.searchParams.set("calendar", "no_refresh");
      return redirectClearingCookie(settingsUrl);
    }
    await updateGoogleCalendarRefreshToken(msa.uid, refresh);
  } catch (e) {
    console.error("google calendar callback", e);
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set(
      "reason",
      e instanceof Error ? e.message.slice(0, 80) : "token_exchange",
    );
    return redirectClearingCookie(settingsUrl);
  }

  settingsUrl.searchParams.set("calendar", "connected");
  return redirectClearingCookie(settingsUrl);
}
