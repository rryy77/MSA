import { recordDayRememberSlots } from "@/lib/dayRemember";
import { fetchGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import { getMsaFixedMeetInviteEmails } from "@/lib/msaMeetInviteEmails";
import type { Session } from "@/lib/types";
import type { Slot } from "@/lib/slots";

import {
  createCalendarEventsWithMeet,
  isGoogleOAuthRefreshFatalError,
} from "./googleCalendar";

/**
 * 確定済みセッションに対し、主催者の Google カレンダーへイベント＋Meet を反映する。
 * トークンなし・API 失敗時は session を確定済みのまま、calendarCreated を false にする。
 */
export async function applyGoogleCalendarToSession(
  userId: string,
  session: Session,
  finalSlotIds: string[],
): Promise<{ calendarWarning?: string }> {
  const slots = finalSlotIds
    .map((id) => session.slots.find((s) => s.id === id))
    .filter((s): s is Slot => Boolean(s));

  if (!slots.length) {
    session.calendarCreated = false;
    session.createdEventIds = [];
    session.calendarMeetLinks = undefined;
    return { calendarWarning: "no_slots" };
  }

  let refreshToken: string | null = null;
  try {
    refreshToken = await fetchGoogleCalendarRefreshToken(userId);
  } catch (e) {
    console.error("fetchGoogleCalendarRefreshToken", e);
    refreshToken = null;
  }
  if (!refreshToken) {
    session.calendarCreated = false;
    session.createdEventIds = [];
    session.calendarMeetLinks = undefined;
    return { calendarWarning: "google_calendar_not_connected" };
  }

  try {
    const attendeeEmails = getMsaFixedMeetInviteEmails();
    const { eventIds, meetLinks } = await createCalendarEventsWithMeet(
      refreshToken,
      slots,
      {
        summaryPrefix: `MSA ${session.triggerDateJst}`,
        attendeeEmails,
      },
    );
    session.calendarCreated = true;
    session.createdEventIds = eventIds;
    session.calendarMeetLinks = meetLinks;
    void recordDayRememberSlots(userId, slots);
    return {};
  } catch (e) {
    console.error("applyGoogleCalendarToSession", e);
    session.calendarCreated = false;
    session.createdEventIds = [];
    session.calendarMeetLinks = undefined;
    if (isGoogleOAuthRefreshFatalError(e)) {
      return { calendarWarning: "google_calendar_refresh_invalid" };
    }
    return { calendarWarning: "google_calendar_api_error" };
  }
}
