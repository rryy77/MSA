import { google } from "googleapis";

import { getAppBaseUrl } from "@/lib/appUrl";

/** 未設定時は getAppBaseUrl() + 固定パス（.env で上書き可） */
export function getGoogleCalendarRedirectUri(): string {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  return `${getAppBaseUrl()}/api/google/calendar/callback`;
}

export function getGoogleOAuthClientOrNull(): InstanceType<typeof google.auth.OAuth2> | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  return new google.auth.OAuth2(clientId, clientSecret, getGoogleCalendarRedirectUri());
}

export function isGoogleCalendarOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
}
