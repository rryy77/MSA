import { getOriginFromRequest } from "@/lib/requestOrigin";

const LINE_CALLBACK_PATH = "/api/line/callback";

/** Cookie: LINE 認可開始時の redirect_uri（トークン交換で同一文字列が必須） */
export const LINE_OAUTH_REDIRECT_COOKIE = "line_oauth_redirect_uri";

export function isSafeLineOAuthRedirectUri(value: string): boolean {
  try {
    const u = new URL(value);
    const p = u.pathname.replace(/\/$/, "") || "/";
    const expected = LINE_CALLBACK_PATH.replace(/\/$/, "");
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

/**
 * LINE Developers の「Callback URL」と一致させる値。
 * LINE_LOGIN_REDIRECT_URI を未設定なら、リクエストのオリジン + /api/line/callback
 */
export function getLineOAuthRedirectUriForRequest(request: Request): string {
  const explicit = process.env.LINE_LOGIN_REDIRECT_URI?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const origin = getOriginFromRequest(request).replace(/\/$/, "");
  return `${origin}${LINE_CALLBACK_PATH}`;
}
