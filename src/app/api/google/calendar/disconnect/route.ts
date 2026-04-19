import { NextResponse } from "next/server";
import { updateGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import { requireMsaOrganizer } from "@/lib/msaApiAuth";

export async function POST() {
  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;

  try {
    await updateGoogleCalendarRefreshToken(auth.ok.msa.uid, null);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
