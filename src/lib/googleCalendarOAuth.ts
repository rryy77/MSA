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
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  // Vercel 等: 必ず x-forwarded-* を優先（request.url が内部 URL になることがある）
  if (forwardedHost) {
    const proto = forwardedProto || "https";
    return `${proto}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.split(",")[0]?.trim() || url.host;
  const proto =
    forwardedProto || (url.protocol === "https:" ? "https" : "http");
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

/** 認可 URL 生成時とコールバックの getToken で同一文字列にするため（リクエストヘッダ差で mismatch になるのを防ぐ） */
export const GCAL_OAUTH_REDIRECT_COOKIE = "msa_gcal_oauth_ru";

export function isSafeOAuthRedirectUri(value: string): boolean {
  try {
    const u = new URL(value);
    const p = u.pathname.replace(/\/$/, "") || "/";
    const expected = CALLBACK_SUFFIX.replace(/\/$/, "");
    if (p !== expected) return false;
    if (u.protocol === "https:") return true;
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** OAuth 完了後の /settings などへのリダイレクト用ベース URL */
export function getPublicBaseUrlFromRedirectUri(redirectUri: string): string {
  const cb = redirectUri.replace(/\/$/, "");
  if (cb.endsWith(CALLBACK_SUFFIX)) {
    return cb.slice(0, -CALLBACK_SUFFIX.length);
  }
  return getAppBaseUrl();
}

/** OAuth 完了後の /settings など、ブラウザと同じオリジンへのリダイレクト用 */
export function getPublicBaseUrlFromRequest(request: Request): string {
  return getPublicBaseUrlFromRedirectUri(getGoogleCalendarRedirectUriForRequest(request));
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
