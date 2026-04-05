import { NextResponse } from "next/server";
import { updateGoogleCalendarRefreshToken } from "@/lib/inviteInbox";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await updateGoogleCalendarRefreshToken(supabase, user.id, null);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
