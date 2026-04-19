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

const CHUNK_MS = 85 * 24 * 60 * 60 * 1000;

/** 長期間の FreeBusy を分割取得して結合（サーバー専用） */
export async function queryPrimaryCalendarBusyMerged(
  refreshToken: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{ start: string; end: string }[]> {
  const t0 = new Date(timeMinIso).getTime();
  const t1 = new Date(timeMaxIso).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) return [];
  const all: { start: string; end: string }[] = [];
  let cur = t0;
  while (cur < t1) {
    const end = Math.min(cur + CHUNK_MS, t1);
    const chunk = await queryPrimaryCalendarBusy(refreshToken, new Date(cur).toISOString(), new Date(end).toISOString());
    all.push(...chunk);
    cur = end;
  }
  return all;
}
