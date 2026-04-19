import { NextResponse } from "next/server";
import { fetchGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import { queryPrimaryCalendarBusy } from "@/lib/googleCalendarFreeBusy";
import { isGoogleCalendarOAuthConfigured } from "@/lib/googleCalendarOAuth";
import { requireMsaOrganizer } from "@/lib/msaApiAuth";

export async function GET(request: Request) {
  if (!isGoogleCalendarOAuthConfigured()) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 503 });
  }

  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from_and_to_required" }, { status: 400 });
  }
  const t0 = new Date(from).getTime();
  const t1 = new Date(to).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }
  /** FreeBusy は長すぎると重いので上限（約 3 ヶ月） */
  const maxMs = 100 * 24 * 60 * 60 * 1000;
  if (t1 - t0 > maxMs) {
    return NextResponse.json({ error: "range_too_long" }, { status: 400 });
  }

  let refreshToken: string | null = null;
  try {
    refreshToken = await fetchGoogleCalendarRefreshToken(auth.ok.msa.uid);
  } catch (e) {
    console.error("busy: token", e);
    return NextResponse.json({ error: "token_fetch_failed" }, { status: 502 });
  }
  if (!refreshToken) {
    return NextResponse.json({ error: "google_calendar_not_connected" }, { status: 403 });
  }

  try {
    const busy = await queryPrimaryCalendarBusy(refreshToken, from, to);
    return NextResponse.json({ busy });
  } catch (e) {
    console.error("freebusy", e);
    return NextResponse.json(
      { error: "freebusy_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
