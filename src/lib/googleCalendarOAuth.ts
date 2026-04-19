import { createHmac, timingSafeEqual } from "crypto";
import { google } from "googleapis";

import { getAppBaseUrl } from "@/lib/appUrl";
import { msaSessionSecret } from "@/lib/msaConfig";

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

/** 旧フロー: Cookie に redirect_uri を載せた場合の名前 */
export const GCAL_OAUTH_REDIRECT_COOKIE = "msa_gcal_oauth_ru";

/**
 * Google がそのまま返す state に redirect_uri を署名込みで載せる（Cookie が届かない環境でも mismatch しない）。
 */
export function encodeGoogleOAuthState(organizerId: string, redirectUri: string): string {
  const payload = JSON.stringify({ o: organizerId, r: redirectUri });
  const b64 = Buffer.from(payload, "utf-8").toString("base64url");
  const sig = createHmac("sha256", msaSessionSecret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function decodeGoogleOAuthState(
  state: string,
): { organizerId: string; redirectUri: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  try {
    const expected = createHmac("sha256", msaSessionSecret()).update(b64).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const inner = JSON.parse(Buffer.from(b64, "base64url").toString("utf-8")) as {
      o?: string;
      r?: string;
    };
    if (typeof inner.o !== "string" || typeof inner.r !== "string") return null;
    if (!isSafeOAuthRedirectUri(inner.r)) return null;
    return { organizerId: inner.o, redirectUri: inner.r };
  } catch {
    return null;
  }
}

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
