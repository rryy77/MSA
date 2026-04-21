import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import { TIMEZONE } from "@/lib/constants";
import {
  buildDayRememberSuggestions,
  buildSetReservationSuggestions,
  buildTimeRememberSuggestions,
  enrichDayRememberSuggestionsWithCalendar,
  fetchDayRememberData,
} from "@/lib/dayRemember";
import { fetchGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import { queryPrimaryCalendarBusyMerged } from "@/lib/googleCalendarFreeBusy";
import { requireMsaOrganizer } from "@/lib/msaApiAuth";

export async function GET() {
  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;

  const remembered = await fetchDayRememberData(auth.ok.msa.uid);
  const suggestions = buildDayRememberSuggestions(remembered.entries);
  const timeSuggestions = buildTimeRememberSuggestions(
    remembered.entries,
    remembered.recentTimeWindows,
  );
  const setSuggestions = buildSetReservationSuggestions(
    remembered.recentDayTimeSets,
  );

  return NextResponse.json({ suggestions, timeSuggestions, setSuggestions });
}

export async function POST(request: Request) {
  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const raw = body as { eligibleDates?: unknown };
  if (!Array.isArray(raw.eligibleDates) || raw.eligibleDates.length === 0) {
    return NextResponse.json({ error: "eligible_dates_required" }, { status: 400 });
  }
  const eligibleDates = raw.eligibleDates.filter((x): x is string => typeof x === "string");
  if (!eligibleDates.length) {
    return NextResponse.json({ error: "eligible_dates_required" }, { status: 400 });
  }

  const remembered = await fetchDayRememberData(auth.ok.msa.uid);
  const base = buildDayRememberSuggestions(remembered.entries);
  const timeSuggestions = buildTimeRememberSuggestions(
    remembered.entries,
    remembered.recentTimeWindows,
  );
  const setSuggestions = buildSetReservationSuggestions(
    remembered.recentDayTimeSets,
  );
  const sorted = [...eligibleDates].sort();

  let refreshToken: string | null = null;
  try {
    refreshToken = await fetchGoogleCalendarRefreshToken(auth.ok.msa.uid);
  } catch (e) {
    console.error("day-remember token", e);
    refreshToken = null;
  }

  if (!refreshToken) {
    return NextResponse.json({ suggestions: base, timeSuggestions, setSuggestions, calendarSkipped: true });
  }

  try {
    const from = DateTime.fromISO(sorted[0], { zone: TIMEZONE }).startOf("day").toISO()!;
    const to = DateTime.fromISO(sorted[sorted.length - 1], { zone: TIMEZONE }).endOf("day").toISO()!;
    const busy = await queryPrimaryCalendarBusyMerged(refreshToken, from, to);
    const suggestions = enrichDayRememberSuggestionsWithCalendar(base, busy, sorted);
    return NextResponse.json({ suggestions, timeSuggestions, setSuggestions });
  } catch (e) {
    console.error("day-remember enrich", e);
    return NextResponse.json({ suggestions: base, timeSuggestions, setSuggestions, calendarSkipped: true });
  }
}
