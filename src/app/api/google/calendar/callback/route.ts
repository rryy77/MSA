import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  GCAL_OAUTH_REDIRECT_COOKIE,
  decodeGoogleOAuthState,
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

function redirectClearingLegacyCookie(url: string | URL): NextResponse {
  const res = NextResponse.redirect(url);
  res.cookies.set(GCAL_OAUTH_REDIRECT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  let cfg;
  try {
    cfg = getMsaConfig();
  } catch {
    const fallbackBase = getPublicBaseUrlFromRedirectUri(
      getGoogleCalendarRedirectUriForRequest(request),
    );
    return redirectClearingLegacyCookie(new URL("/login", fallbackBase));
  }

  const decoded = stateParam ? decodeGoogleOAuthState(stateParam) : null;

  let redirectUri: string;
  if (decoded) {
    if (decoded.organizerId !== cfg.organizerId) {
      const base = getPublicBaseUrlFromRedirectUri(decoded.redirectUri);
      const settingsUrl = new URL("/settings", base);
      settingsUrl.searchParams.set("calendar", "error");
      settingsUrl.searchParams.set("reason", "state_mismatch");
      return redirectClearingLegacyCookie(settingsUrl);
    }
    redirectUri = decoded.redirectUri;
  } else if (stateParam === cfg.organizerId) {
    /** 旧: state が UUID のみだったデプロイ向け */
    const storedRu = cookieStore.get(GCAL_OAUTH_REDIRECT_COOKIE)?.value;
    redirectUri =
      storedRu && isSafeOAuthRedirectUri(storedRu)
        ? storedRu
        : getGoogleCalendarRedirectUriForRequest(request);
  } else {
    const base = getPublicBaseUrlFromRedirectUri(
      getGoogleCalendarRedirectUriForRequest(request),
    );
    const settingsUrl = new URL("/settings", base);
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "state_mismatch");
    return redirectClearingLegacyCookie(settingsUrl);
  }

  const base = getPublicBaseUrlFromRedirectUri(redirectUri);
  const settingsUrl = new URL("/settings", base);

  if (err) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", err);
    const desc = url.searchParams.get("error_description");
    if (desc) {
      settingsUrl.searchParams.set("detail", desc.slice(0, 500));
    }
    return redirectClearingLegacyCookie(settingsUrl);
  }

  if (!code || !stateParam) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "missing_code");
    return redirectClearingLegacyCookie(settingsUrl);
  }

  const msa = getMsaSessionFromCookies(cookieStore);
  if (!msa || msa.role !== "organizer" || msa.uid !== cfg.organizerId) {
    return redirectClearingLegacyCookie(
      new URL(`/login?next=${encodeURIComponent("/settings")}`, base),
    );
  }

  const oauth2 = getGoogleOAuthClientForRedirect(redirectUri);
  if (!oauth2) {
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set("reason", "oauth_not_configured");
    return redirectClearingLegacyCookie(settingsUrl);
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    const existing = await fetchGoogleCalendarRefreshToken(msa.uid);
    const refresh = tokens.refresh_token ?? existing ?? null;
    if (!refresh) {
      settingsUrl.searchParams.set("calendar", "no_refresh");
      return redirectClearingLegacyCookie(settingsUrl);
    }
    await updateGoogleCalendarRefreshToken(msa.uid, refresh);
  } catch (e) {
    console.error("google calendar callback", e);
    settingsUrl.searchParams.set("calendar", "error");
    settingsUrl.searchParams.set(
      "reason",
      e instanceof Error ? e.message.slice(0, 80) : "token_exchange",
    );
    return redirectClearingLegacyCookie(settingsUrl);
  }

  settingsUrl.searchParams.set("calendar", "connected");
  return redirectClearingLegacyCookie(settingsUrl);
}
