import { DateTime } from "luxon";
import { randomBytes } from "crypto";
import { TIMEZONE } from "./constants";
import { getSelectableDatesJst } from "./dateRange";
import type { Session } from "./types";

function newId() {
  return randomBytes(12).toString("hex");
}

function participantToken() {
  return randomBytes(16).toString("base64url");
}

export function createSession(trigger: Date = new Date()): Session {
  const jst = DateTime.fromJSDate(trigger).setZone(TIMEZONE);
  const triggerDateJst = jst.toISODate()!;
  const candidateDates = getSelectableDatesJst(trigger);

  return {
    id: newId(),
    triggerAt: trigger.toISOString(),
    triggerDateJst,
    candidateDates,
    status: "awaiting_organizer_round1",
    slots: [],
    organizerRound1Ids: [],
    participantIds: [],
    organizerFinalIds: [],
    participantToken: participantToken(),
    calendarCreated: false,
    createdEventIds: [],
  };
}
