import { NextResponse } from "next/server";
import { getMsaAuth } from "@/lib/msaApiAuth";
import { maxIsoEndFromSlots } from "@/lib/inviteInbox";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSession } from "@/lib/store";

export async function GET() {
  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  await service
    .from("invite_notifications")
    .delete()
    .eq("recipient_user_id", auth.ok.msa.uid)
    .lt("expires_at", nowIso);

  const { data, error } = await service
    .from("invite_notifications")
    .select(
      "id, session_id, subject, invite_url, created_at, read_at, text_body, html_body",
    )
    .eq("recipient_user_id", auth.ok.msa.uid)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "inbox_fetch_failed", detail: error.message },
      { status: 502 },
    );
  }

  const items = data ?? [];
  const cfg = auth.ok.cfg;
  const uid = auth.ok.msa.uid;
  const toDelete: string[] = [];
  const nowMs = Date.now();

  for (const row of items) {
    const sess = await getSession(row.session_id);
    if (!sess) {
      toDelete.push(row.id);
      continue;
    }

    /** 残すのは「B の受信トレイにある、A→B の進行中案内」のみ */
    const keepForParticipantPending =
      uid === cfg.participantId && sess.status === "awaiting_participant_availability";
    if (!keepForParticipantPending) {
      toDelete.push(row.id);
      continue;
    }

    /** 進行中であっても、候補時刻がすべて過去なら削除 */
    if (sess.slots?.length) {
      const maxEnd = maxIsoEndFromSlots(sess.slots);
      if (maxEnd && new Date(maxEnd).getTime() < nowMs) toDelete.push(row.id);
    }
  }

  if (toDelete.length) {
    await service.from("invite_notifications").delete().in("id", toDelete);
  }

  const pruned = items.filter((row) => !toDelete.includes(row.id));
  return NextResponse.json({ items: pruned });
}
