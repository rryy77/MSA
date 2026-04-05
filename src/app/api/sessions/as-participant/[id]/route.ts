import { NextResponse } from "next/server";
import { getSelectableDatesJst } from "@/lib/dateRange";
import { supabaseNotConfiguredResponse } from "@/lib/supabase/api";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/store";
import type { Session } from "@/lib/types";

function withDefaults(s: Session): Session {
  const candidateDates =
    s.candidateDates?.length ? s.candidateDates : getSelectableDatesJst(new Date(s.triggerAt));
  return { ...s, candidateDates };
}

/** 参加者本人のみセッション取得（候補にチェックを付ける画面用） */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  if (!supabase) {
    return supabaseNotConfiguredResponse();
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await getSession(id);
  if (!raw) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (raw.participantUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (raw.status !== "awaiting_participant_availability") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }
  return NextResponse.json({ session: withDefaults(raw) });
}
