import { google } from "googleapis";

import { getGoogleOAuthClientOrNull } from "./googleCalendarOAuth";

/**
 * 主催者の primary カレンダーの予定あり区間（FreeBusy）。
 * scope に calendar.readonly（または calendar）が含まれる必要があります。
 */
export async function queryPrimaryCalendarBusy(
  refreshToken: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{ start: string; end: string }[]> {
  const oauth2 = getGoogleOAuthClientOrNull();
  if (!oauth2) {
    throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  }
  oauth2.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2 });

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      items: [{ id: "primary" }],
    },
  });

  const busy = res.data.calendars?.primary?.busy ?? [];
  return busy
    .filter((b): b is { start?: string; end?: string } => Boolean(b?.start && b?.end))
    .map((b) => ({ start: b.start!, end: b.end! }));
}
