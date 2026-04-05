import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getSelectableDatesJst } from "@/lib/dateRange";
import {
  buildParticipantInvitePayload,
  isOutboundEmailConfigured,
  sendOrganizerParticipantRepliedEmail,
  sendParticipantInviteEmail,
} from "@/lib/mailer";
import {
  fetchProfileByEmail,
  fetchProfileEmail,
  insertInviteNotification,
} from "@/lib/inviteInbox";
import { buildSlotsDetailed, buildSlotsFromSchedule } from "@/lib/slots";
import { supabaseNotConfiguredResponse } from "@/lib/supabase/api";
import { createClient } from "@/lib/supabase/server";
import { getSession, putSession } from "@/lib/store";
import type { Session } from "@/lib/types";
import { fireAndForgetPush } from "@/lib/webPushServer";

type PatchBody =
  | { action: "build_slots"; items: { ymd: string; timeStart: string; timeEnd: string }[] }
  | { action: "build_slots"; dates: string[]; timeStart: string; timeEnd: string }
  | { action: "organizer_round1"; slotIds: string[] }
  | { action: "participant"; token: string; slotIds: string[] }
  | { action: "organizer_final"; slotIds: string[] }
  | { action: "wizard_finalize"; participantUserId?: string }
  | { action: "send_schedule_invite"; participantEmail: string }
  | { action: "participant_submit_availability"; slotIds: string[] }
  | { action: "organizer_confirm_final"; slotIds: string[] };

const HM = /^\d{1,2}:\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function withDefaults(s: Session): Session {
  const candidateDates =
    s.candidateDates?.length ? s.candidateDates : getSelectableDatesJst(new Date(s.triggerAt));
  return { ...s, candidateDates };
}

function slotIdSet(s: Session) {
  return new Set(s.slots.map((x) => x.id));
}

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
  if (!raw.organizerUserId || raw.organizerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const session = withDefaults(raw);
  return NextResponse.json({ session });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raw = await getSession(id);
  if (!raw) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (raw.status === "completed") {
    return NextResponse.json({ error: "already_completed" }, { status: 409 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.action === "participant") {
    const session = withDefaults(raw);
    if (session.status !== "awaiting_participant") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (body.token !== session.participantToken) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!body.slotIds?.length) {
      return NextResponse.json({ error: "slot_ids_required" }, { status: 400 });
    }
    const allowed = new Set(session.organizerRound1Ids);
    for (const sid of body.slotIds) {
      if (!allowed.has(sid)) return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
    }
    session.participantIds = body.slotIds;
    session.status = "awaiting_organizer_final";
    await putSession(session);
    return NextResponse.json({ session });
  }

  if (body.action === "participant_submit_availability") {
    const supabaseP = await createClient();
    if (!supabaseP) {
      return supabaseNotConfiguredResponse();
    }
    const {
      data: { user: participantUser },
    } = await supabaseP.auth.getUser();
    if (!participantUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const sessionP = withDefaults(raw);
    if (sessionP.status !== "awaiting_participant_availability") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (sessionP.participantUserId !== participantUser.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!body.slotIds?.length) {
      return NextResponse.json({ error: "slot_ids_required" }, { status: 400 });
    }
    const allowed = new Set(sessionP.organizerRound1Ids);
    for (const sid of body.slotIds) {
      if (!allowed.has(sid)) {
        return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
      }
    }
    sessionP.participantPreferredSlotIds = body.slotIds;
    sessionP.participantIds = body.slotIds;
    sessionP.status = "awaiting_organizer_confirm";
    await putSession(sessionP);

    const basePush = getAppBaseUrl();
    fireAndForgetPush(sessionP.organizerUserId, {
      title: "MSA: 日程の返信",
      body: "参加者が候補を選びました",
      url: `${basePush}/session/${sessionP.id}`,
    });

    if (sessionP.organizerUserId && isOutboundEmailConfigured()) {
      const pickedSlots = sessionP.slots.filter((s) =>
        sessionP.participantPreferredSlotIds?.includes(s.id),
      );
      try {
        const orgEmail = await fetchProfileEmail(supabaseP, sessionP.organizerUserId);
        if (orgEmail) {
          const base = getAppBaseUrl();
          const sessionUrl = `${base}/session/${sessionP.id}`;
          await sendOrganizerParticipantRepliedEmail(orgEmail, sessionUrl, {
            sessionId: sessionP.id,
            participantSlots: pickedSlots,
          });
        }
      } catch (e) {
        console.error("organizer_reply_email", e);
      }
    }

    return NextResponse.json({ session: sessionP });
  }

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

  const session = withDefaults(raw);
  if (!session.organizerUserId) {
    return NextResponse.json({ error: "legacy_session" }, { status: 403 });
  }
  if (session.organizerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (body.action === "build_slots") {
    if (session.status !== "awaiting_organizer_round1") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (session.slots.length > 0) {
      return NextResponse.json({ error: "slots_already_built" }, { status: 409 });
    }
    const allowed = new Set(session.candidateDates);
    let slots;

    if ("items" in body && Array.isArray(body.items)) {
      if (!body.items.length) {
        return NextResponse.json({ error: "items_required" }, { status: 400 });
      }
      for (const it of body.items) {
        if (!allowed.has(it.ymd)) return NextResponse.json({ error: "invalid_date" }, { status: 400 });
        if (!HM.test(it.timeStart) || !HM.test(it.timeEnd)) {
          return NextResponse.json({ error: "invalid_time_format" }, { status: 400 });
        }
      }
      slots = buildSlotsDetailed(body.items);
    } else {
      const { dates, timeStart, timeEnd } = body as {
        dates: string[];
        timeStart: string;
        timeEnd: string;
      };
      if (!dates?.length) {
        return NextResponse.json({ error: "dates_required" }, { status: 400 });
      }
      if (!HM.test(timeStart) || !HM.test(timeEnd)) {
        return NextResponse.json({ error: "invalid_time_format" }, { status: 400 });
      }
      for (const d of dates) {
        if (!allowed.has(d)) return NextResponse.json({ error: "invalid_date" }, { status: 400 });
      }
      slots = buildSlotsFromSchedule(dates, timeStart, timeEnd);
    }

    if (!slots.length) {
      return NextResponse.json({ error: "no_valid_slots" }, { status: 400 });
    }
    session.slots = slots;
    await putSession(session);
    return NextResponse.json({ session });
  }

  if (body.action === "send_schedule_invite") {
    if (session.status !== "awaiting_organizer_round1") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (!session.slots.length) {
      return NextResponse.json({ error: "build_slots_first" }, { status: 409 });
    }
    const em =
      typeof body.participantEmail === "string" ? body.participantEmail.trim().toLowerCase() : "";
    if (!em || !EMAIL_RE.test(em)) {
      return NextResponse.json({ error: "invalid_participant_email" }, { status: 400 });
    }

    const profile = await fetchProfileByEmail(supabase, em);
    if (!profile) {
      return NextResponse.json(
        { error: "participant_not_registered", message: "このメールはアプリ未登録です" },
        { status: 400 },
      );
    }
    if (profile.id === user.id) {
      return NextResponse.json({ error: "participant_is_self" }, { status: 400 });
    }

    const allIds = session.slots.map((s) => s.id);
    session.organizerRound1Ids = allIds;
    session.participantUserId = profile.id;
    session.participantEmail = em;
    session.status = "awaiting_participant_availability";
    session.scheduleInviteSentAt = new Date().toISOString();
    session.emailSentAt = new Date().toISOString();

    const base = getAppBaseUrl();
    const respondUrl = `${base}/respond/${session.id}`;

    const payload = buildParticipantInvitePayload(respondUrl, {
      sessionId: session.id,
      slots: session.slots,
    });

    let inviteEmailSent = false;
    try {
      await insertInviteNotification(supabase, {
        sessionId: session.id,
        recipientUserId: profile.id,
        organizerUserId: user.id,
        subject: payload.subject,
        textBody: payload.text,
        htmlBody: payload.html,
        inviteUrl: respondUrl,
      });
    } catch (e) {
      console.error(e);
      return NextResponse.json(
        {
          error: "inbox_save_failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 502 },
      );
    }

    fireAndForgetPush(profile.id, {
      title: "MSA: 参加案内",
      body: "日程調整の案内が届きました",
      url: respondUrl,
    });

    const recipientAddr = profile.email ?? em;
    if (isOutboundEmailConfigured() && recipientAddr) {
      try {
        await sendParticipantInviteEmail(recipientAddr, respondUrl, {
          sessionId: session.id,
          slots: session.slots,
        });
        inviteEmailSent = true;
        session.inviteEmailSentAt = new Date().toISOString();
      } catch (e) {
        console.error("invite_email_optional", e);
      }
    }

    await putSession(session);
    return NextResponse.json({ session, inviteEmailSent });
  }

  if (body.action === "wizard_finalize") {
    if (session.status !== "awaiting_organizer_round1") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (!session.slots.length) {
      return NextResponse.json({ error: "build_slots_first" }, { status: 409 });
    }

    let participantUserId: string | undefined;
    if (
      "participantUserId" in body &&
      typeof body.participantUserId === "string" &&
      body.participantUserId.trim()
    ) {
      const pid = body.participantUserId.trim();
      if (!isUuid(pid)) {
        return NextResponse.json({ error: "invalid_participant_user" }, { status: 400 });
      }
      if (pid === user.id) {
        return NextResponse.json({ error: "participant_is_self" }, { status: 400 });
      }
      participantUserId = pid;
    }

    const all = session.slots.map((x) => x.id);
    session.organizerRound1Ids = all;
    session.participantIds = all;
    session.organizerFinalIds = all;
    session.calendarCreated = true;
    session.createdEventIds = all.map((sid, i) => `mock_evt_${session.id}_${i}_${sid}`);
    session.status = "completed";
    session.finalizedAt = new Date().toISOString();
    session.emailSentAt = new Date().toISOString();
    if (participantUserId) {
      session.participantUserId = participantUserId;
    }

    const base = getAppBaseUrl();
    const inviteUrl = `${base}/p/${encodeURIComponent(session.participantToken)}`;

    let inviteEmailSent = false;

    if (participantUserId) {
      const recipientEmail = await fetchProfileEmail(supabase, participantUserId);
      if (!recipientEmail) {
        return NextResponse.json({ error: "profile_not_found" }, { status: 400 });
      }

      const payload = buildParticipantInvitePayload(inviteUrl, {
        sessionId: session.id,
        slots: session.slots,
      });

      try {
        await insertInviteNotification(supabase, {
          sessionId: session.id,
          recipientUserId: participantUserId,
          organizerUserId: user.id,
          subject: payload.subject,
          textBody: payload.text,
          htmlBody: payload.html,
          inviteUrl,
        });
      } catch (e) {
        console.error(e);
        return NextResponse.json(
          {
            error: "inbox_save_failed",
            detail: e instanceof Error ? e.message : String(e),
          },
          { status: 502 },
        );
      }

      fireAndForgetPush(participantUserId, {
        title: "MSA: 参加案内",
        body: "日程調整の案内が届きました",
        url: inviteUrl,
      });

      if (isOutboundEmailConfigured()) {
        try {
          await sendParticipantInviteEmail(recipientEmail, inviteUrl, {
            sessionId: session.id,
            slots: session.slots,
          });
          inviteEmailSent = true;
          session.inviteEmailSentAt = new Date().toISOString();
        } catch (e) {
          console.error("invite_email_optional", e);
        }
      }
    }

    await putSession(session);
    return NextResponse.json({ session, inviteEmailSent });
  }

  const validIds = slotIdSet(session);

  if (body.action === "organizer_round1") {
    if (session.status !== "awaiting_organizer_round1") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (!session.slots.length) {
      return NextResponse.json({ error: "build_slots_first" }, { status: 409 });
    }
    if (!body.slotIds?.length) {
      return NextResponse.json({ error: "slot_ids_required" }, { status: 400 });
    }
    for (const sid of body.slotIds) {
      if (!validIds.has(sid)) return NextResponse.json({ error: "unknown_slot" }, { status: 400 });
    }
    session.organizerRound1Ids = body.slotIds;
    session.status = "awaiting_participant";
    await putSession(session);
    return NextResponse.json({ session });
  }

  if (body.action === "organizer_final") {
    if (session.status !== "awaiting_organizer_final") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (!body.slotIds?.length) {
      return NextResponse.json({ error: "slot_ids_required" }, { status: 400 });
    }
    const allowed = new Set(session.participantIds);
    for (const sid of body.slotIds) {
      if (!allowed.has(sid)) return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
    }
    session.organizerFinalIds = body.slotIds;
    session.calendarCreated = true;
    session.createdEventIds = body.slotIds.map((sid, i) => `mock_evt_${session.id}_${i}_${sid}`);
    session.status = "completed";
    session.finalizedAt = new Date().toISOString();
    await putSession(session);
    return NextResponse.json({ session });
  }

  if (body.action === "organizer_confirm_final") {
    if (session.status !== "awaiting_organizer_confirm") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    const participantPicks = session.participantPreferredSlotIds ?? [];
    if (!participantPicks.length) {
      return NextResponse.json({ error: "no_participant_selection" }, { status: 400 });
    }
    if (!body.slotIds?.length) {
      return NextResponse.json({ error: "slot_ids_required" }, { status: 400 });
    }
    const round = new Set(session.organizerRound1Ids);
    for (const sid of body.slotIds) {
      if (!round.has(sid)) {
        return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
      }
    }
    const participantSet = new Set(participantPicks);
    const finalIds = body.slotIds.filter((id) => participantSet.has(id));
    if (finalIds.length === 0) {
      return NextResponse.json(
        {
          error: "no_overlap",
          message: "参加者の候補と主催者の候補に共通する枠がありません。主催者のチェックを調整してください。",
        },
        { status: 400 },
      );
    }
    session.organizerPreferredSlotIds = body.slotIds;
    session.organizerFinalIds = finalIds;
    session.calendarCreated = true;
    session.createdEventIds = finalIds.map((sid, i) => `mock_evt_${session.id}_${i}_${sid}`);
    session.status = "completed";
    session.finalizedAt = new Date().toISOString();
    await putSession(session);
    return NextResponse.json({ session });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
