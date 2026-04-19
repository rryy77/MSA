import { google } from "googleapis";

import { getAppBaseUrl } from "@/lib/appUrl";

/** 未設定時は getAppBaseUrl() + 固定パス（.env で上書き可）。リクエストがない API 向け。 */
export function getGoogleCalendarRedirectUri(): string {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  return `${getAppBaseUrl()}/api/google/calendar/callback`;
}

/**
 * ブラウザが実際に開いているホストと一致する redirect_uri（400 redirect_uri_mismatch 対策）。
 * GOOGLE_CALENDAR_REDIRECT_URI が未設定のとき、Vercel の VERCEL_URL とカスタムドメインの食い違いを防ぐ。
 */
function getOriginFromRequest(request: Request): string {
  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.split(",")[0]?.trim() ||
    url.host;
  let proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!proto) {
    proto = url.protocol === "https:" ? "https" : "http";
  }
  return `${proto}://${host}`;
}

export function getGoogleCalendarRedirectUriForRequest(request: Request): string {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  try {
    const origin = getOriginFromRequest(request).replace(/\/$/, "");
    if (origin.length > 8) {
      return `${origin}/api/google/calendar/callback`;
    }
  } catch {
    /* fall through */
  }
  return getGoogleCalendarRedirectUri();
}

const CALLBACK_SUFFIX = "/api/google/calendar/callback";

/** OAuth 完了後の /settings など、ブラウザと同じオリジンへのリダイレクト用 */
export function getPublicBaseUrlFromRequest(request: Request): string {
  const cb = getGoogleCalendarRedirectUriForRequest(request).replace(/\/$/, "");
  if (cb.endsWith(CALLBACK_SUFFIX)) {
    return cb.slice(0, -CALLBACK_SUFFIX.length);
  }
  return getAppBaseUrl();
}

export function getGoogleOAuthClientForRedirect(
  redirectUri: string,
): InstanceType<typeof google.auth.OAuth2> | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Calendar API の refresh_token 利用時。redirect は登録済みのいずれかで可。 */
export function getGoogleOAuthClientOrNull(): InstanceType<typeof google.auth.OAuth2> | null {
  return getGoogleOAuthClientForRedirect(getGoogleCalendarRedirectUri());
}

export function isGoogleCalendarOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
}
