import { NextResponse } from "next/server";
import { createSession } from "@/lib/sessionFactory";
import { supabaseNotConfiguredResponse } from "@/lib/supabase/api";
import { createClient } from "@/lib/supabase/server";
import { putSession, listSessionSummaries } from "@/lib/store";

export async function GET() {
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
  const list = await listSessionSummaries(user.id);
  return NextResponse.json({ sessions: list });
}

export async function POST() {
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
  const session = createSession(new Date());
  session.organizerUserId = user.id;
  await putSession(session);
  return NextResponse.json({ session });
}
