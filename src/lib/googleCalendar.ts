import { randomUUID } from "crypto";
import { google } from "googleapis";

import { TIMEZONE } from "@/lib/constants";
import type { Slot } from "@/lib/slots";

import { getGoogleOAuthClientOrNull } from "./googleCalendarOAuth";

function gaxiosMessage(e: unknown): string {
  if (e && typeof e === "object" && "response" in e) {
    const r = (e as { response?: { data?: unknown } }).response;
    const d = r?.data;
    if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      if (typeof o.error === "object" && o.error && "message" in o.error) {
        return String((o.error as { message?: string }).message ?? "");
      }
      if (typeof o.error_description === "string") return o.error_description;
      if (typeof o.error === "string") return o.error;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** トークン失効・クライアント不一致など、Meet なし再試行では直らないもの */
export function isGoogleOAuthRefreshFatalError(e: unknown): boolean {
  const m = gaxiosMessage(e).toLowerCase();
  return (
    m.includes("invalid_grant") ||
    m.includes("invalid_client") ||
    m.includes("unauthorized_client")
  );
}

/**
 * 主催者カレンダーに、枠ごとにイベントを作成し Meet を付与する。
 * Meet 付き作成がポリシー等で失敗した場合は Meet なしで再試行する。
 */
export async function createCalendarEventsWithMeet(
  refreshToken: string,
  slots: Slot[],
  opts: { summaryPrefix: string; attendeeEmail?: string | null },
): Promise<{ eventIds: string[]; meetLinks: string[] }> {
  const oauth2 = getGoogleOAuthClientOrNull();
  if (!oauth2) {
    throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  }
  oauth2.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2 });

  const eventIds: string[] = [];
  const meetLinks: string[] = [];

  for (const slot of slots) {
    const baseBody = {
      summary: `${opts.summaryPrefix} — ${slot.label}`,
      description: "Meet Schedule Assistant（MSA）で確定した日程です。",
      start: { dateTime: slot.start, timeZone: TIMEZONE },
      end: { dateTime: slot.end, timeZone: TIMEZONE },
      attendees: opts.attendeeEmail
        ? [{ email: opts.attendeeEmail }]
        : undefined,
    };

    let res;
    try {
      res = await calendar.events.insert({
        calendarId: "primary",
        conferenceDataVersion: 1,
        requestBody: {
          ...baseBody,
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        },
      });
    } catch (first: unknown) {
      if (isGoogleOAuthRefreshFatalError(first)) {
        console.error("Google Calendar: auth error (no Meet retry)", first);
        throw first;
      }
      console.warn(
        "Google Calendar: insert with Meet failed, retrying without Meet",
        gaxiosMessage(first),
      );
      try {
        res = await calendar.events.insert({
          calendarId: "primary",
          requestBody: baseBody,
        });
      } catch (second: unknown) {
        console.error("Google Calendar: insert without Meet also failed", second);
        throw second;
      }
    }

    const id = res.data.id;
    if (!id) {
      throw new Error("calendar_no_event_id");
    }
    eventIds.push(id);
    const link =
      res.data.hangoutLink ||
      res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
        ?.uri ||
      "";
    meetLinks.push(link || "");
  }

  return { eventIds, meetLinks };
}
