import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getMsaConfig } from "@/lib/msaConfig";
import { getMsaSessionFromCookies } from "@/lib/msaSession";
import { getSelectableDatesJstYear } from "@/lib/dateRange";
import { buildParticipantInvitePayload } from "@/lib/mailer";
import { applyGoogleCalendarToSession } from "@/lib/googleCalendarFinalize";
import { insertInviteNotification, maxIsoEndFromSlots } from "@/lib/inviteInbox";
import { buildSlotsDetailed, buildSlotsFromSchedule } from "@/lib/slots";
import { persistSessionOrError } from "@/lib/sessionStorageResponse";
import { getSession } from "@/lib/store";
import type { Session } from "@/lib/types";
import { fireAndForgetLineMessagingForUser } from "@/lib/lineMessagingPush";
import { fireAndForgetPush } from "@/lib/webPushServer";

type PatchBody =
  | { action: "build_slots"; items: { ymd: string; timeStart: string; timeEnd: string }[] }
  | { action: "build_slots"; dates: string[]; timeStart: string; timeEnd: string }
  | { action: "organizer_round1"; slotIds: string[] }
  | { action: "participant"; token: string; slotIds: string[] }
  | { action: "organizer_final"; slotIds: string[] }
  | { action: "wizard_finalize" }
  | { action: "send_schedule_invite" }
  | { action: "participant_submit_availability"; slotIds: string[] }
  | { action: "participant_submit_availability_token"; token: string; slotIds: string[] }
  | { action: "organizer_confirm_final"; slotIds: string[] };

const HM = /^\d{1,2}:\d{2}$/;

function formatSlotLabelsForNotify(session: Session, slotIds: string[]): string {
  const lines = slotIds
    .map((id) => session.slots.find((s) => s.id === id)?.label)
    .filter((x): x is string => Boolean(x));
  if (lines.length === 0) return "（候補なし）";
  return lines.map((l) => `・${l}`).join("\n");
}

/** B 確定後、主催者（A）向け：日程一覧 + Google カレンダー成否 + Meet リンク */
function buildOrganizerFinalizeLineMessage(sessionP: Session): string {
  const base = getAppBaseUrl();
  const sessionUrl = `${base}/session/${sessionP.id}`;
  const ids = sessionP.organizerFinalIds ?? [];
  const scheduleBlock = formatSlotLabelsForNotify(sessionP, ids);

  const calOk = sessionP.calendarCreated === true;
  const calLine = calOk
    ? "✅ Google カレンダーに予定を追加しました。"
    : "⚠️ Google カレンダーへの自動追加はできませんでした（設定でカレンダー連携を確認してください）。";

  const links = (sessionP.calendarMeetLinks ?? []).filter(Boolean);
  const meetLine =
    calOk && links.length > 0 ? `\nMeet: ${links[0]}` : "";

  return [
    "MSA（日程調整）",
    "参加者（B）が候補を確定しました。",
    "",
    `開始日（トリガー）: ${sessionP.triggerDateJst}`,
    "",
    "【確定した日程】",
    scheduleBlock,
    "",
    calLine + meetLine,
    "",
    `詳細: ${sessionUrl}`,
  ].join("\n");
}

/** B が確定したあと、A にアプリ内通知・プッシュ・LINE のみ（メールは送らない） */
async function notifyOrganizerSessionFinalized(
  sessionP: Session,
  cfg: { organizerId: string; participantId: string },
) {
  const basePush = getAppBaseUrl();
  const sessionUrl = `${basePush}/session/${sessionP.id}`;
  const lineText = buildOrganizerFinalizeLineMessage(sessionP);

  if (sessionP.organizerUserId) {
    fireAndForgetPush(sessionP.organizerUserId, {
      title: "MSA: B が日程を確定しました",
      body: sessionP.calendarCreated
        ? "Google カレンダーに反映しました。タップで詳細。"
        : "日程が確定しました。カレンダー未反映の可能性があります。",
      url: sessionUrl,
    });
    fireAndForgetLineMessagingForUser(sessionP.organizerUserId, lineText);
  }
  try {
    const safeHtml = lineText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const finSlots = sessionP.organizerFinalIds
      .map((id) => sessionP.slots.find((x) => x.id === id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    await insertInviteNotification({
      sessionId: sessionP.id,
      recipientUserId: cfg.organizerId,
      organizerUserId: cfg.participantId,
      subject: "MSA: 参加者が日程を確定しました",
      textBody: lineText,
      htmlBody: `<pre style="white-space:pre-wrap;font-family:inherit">${safeHtml}</pre><p><a href="${sessionUrl}">セッションを開く</a></p>`,
      inviteUrl: sessionUrl,
      expiresAt: maxIsoEndFromSlots(finSlots),
    });
  } catch (e) {
    console.error("organizer_finalize_inbox", e);
  }
}

function withDefaults(s: Session): Session {
  const candidateDates =
    s.candidateDates?.length ? s.candidateDates : getSelectableDatesJstYear(new Date(s.triggerAt));
  return { ...s, candidateDates };
}

function slotIdSet(s: Session) {
  return new Set(s.slots.map((x) => x.id));
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let cfg;
  try {
    cfg = getMsaConfig();
  } catch {
    return NextResponse.json({ error: "msa_not_configured" }, { status: 503 });
  }
  const msa = getMsaSessionFromCookies(await cookies());
  if (!msa || msa.role !== "organizer" || msa.uid !== cfg.organizerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await getSession(id);
  if (!raw) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!raw.organizerUserId || raw.organizerUserId !== msa.uid) {
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
    {
      const persistErr = await persistSessionOrError(session);
      if (persistErr) return persistErr;
    }
    return NextResponse.json({ session });
  }

  /** トークンリンク用: ログイン不要。確定は B のみ → A へ通知のみ、A の Google カレンダーに反映 */
  if (body.action === "participant_submit_availability_token") {
    let cfgToken;
    try {
      cfgToken = getMsaConfig();
    } catch {
      return NextResponse.json({ error: "msa_not_configured" }, { status: 503 });
    }
    const sessionP = withDefaults(raw);
    if (sessionP.status !== "awaiting_participant_availability") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (typeof body.token !== "string" || body.token !== sessionP.participantToken) {
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
    if (!sessionP.organizerUserId) {
      return NextResponse.json({ error: "legacy_session" }, { status: 403 });
    }

    sessionP.participantPreferredSlotIds = body.slotIds;
    sessionP.participantIds = body.slotIds;
    sessionP.organizerFinalIds = body.slotIds;
    sessionP.status = "completed";
    sessionP.finalizedAt = new Date().toISOString();

    const { calendarWarning } = await applyGoogleCalendarToSession(
      sessionP.organizerUserId,
      sessionP,
      body.slotIds,
    );
    {
      const persistErr = await persistSessionOrError(sessionP);
      if (persistErr) return persistErr;
    }

    await notifyOrganizerSessionFinalized(sessionP, {
      organizerId: cfgToken.organizerId,
      participantId: cfgToken.participantId,
    });

    return NextResponse.json({
      session: sessionP,
      ...(calendarWarning ? { calendarWarning } : {}),
    });
  }

  if (body.action === "participant_submit_availability") {
    let cfg;
    try {
      cfg = getMsaConfig();
    } catch {
      return NextResponse.json({ error: "msa_not_configured" }, { status: 503 });
    }
    const msaP = getMsaSessionFromCookies(await cookies());
    if (!msaP || msaP.role !== "participant" || msaP.uid !== cfg.participantId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const sessionP = withDefaults(raw);
    if (sessionP.status !== "awaiting_participant_availability") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (sessionP.participantUserId !== msaP.uid) {
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
    if (!sessionP.organizerUserId) {
      return NextResponse.json({ error: "legacy_session" }, { status: 403 });
    }

    sessionP.participantPreferredSlotIds = body.slotIds;
    sessionP.participantIds = body.slotIds;
    sessionP.organizerFinalIds = body.slotIds;
    sessionP.status = "completed";
    sessionP.finalizedAt = new Date().toISOString();

    const { calendarWarning } = await applyGoogleCalendarToSession(
      sessionP.organizerUserId,
      sessionP,
      body.slotIds,
    );
    {
      const persistErr = await persistSessionOrError(sessionP);
      if (persistErr) return persistErr;
    }

    await notifyOrganizerSessionFinalized(sessionP, {
      organizerId: cfg.organizerId,
      participantId: cfg.participantId,
    });

    return NextResponse.json({
      session: sessionP,
      ...(calendarWarning ? { calendarWarning } : {}),
    });
  }

  let cfgOrg;
  try {
    cfgOrg = getMsaConfig();
  } catch {
    return NextResponse.json({ error: "msa_not_configured" }, { status: 503 });
  }
  const msaOrg = getMsaSessionFromCookies(await cookies());
  if (!msaOrg || msaOrg.role !== "organizer" || msaOrg.uid !== cfgOrg.organizerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = withDefaults(raw);
  if (!session.organizerUserId) {
    return NextResponse.json({ error: "legacy_session" }, { status: 403 });
  }
  if (session.organizerUserId !== msaOrg.uid) {
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
    {
      const persistErr = await persistSessionOrError(session);
      if (persistErr) return persistErr;
    }
    return NextResponse.json({ session });
  }

  if (body.action === "send_schedule_invite") {
    if (session.status !== "awaiting_organizer_round1") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (!session.slots.length) {
      return NextResponse.json({ error: "build_slots_first" }, { status: 409 });
    }
    const participantUserId = cfgOrg.participantId;
    if (participantUserId === msaOrg.uid) {
      return NextResponse.json({ error: "participant_is_self" }, { status: 400 });
    }

    const allIds = session.slots.map((s) => s.id);
    session.organizerRound1Ids = allIds;
    session.participantUserId = participantUserId;
    session.status = "awaiting_participant_availability";
    session.scheduleInviteSentAt = new Date().toISOString();
    session.emailSentAt = new Date().toISOString();

    const base = getAppBaseUrl();
    const respondUrl = `${base}/p/${encodeURIComponent(session.participantToken)}`;

    const payload = buildParticipantInvitePayload(respondUrl, {
      sessionId: session.id,
      slots: session.slots,
    });

    try {
      await insertInviteNotification({
        sessionId: session.id,
        recipientUserId: participantUserId,
        organizerUserId: msaOrg.uid,
        subject: payload.subject,
        textBody: payload.text,
        htmlBody: payload.html,
        inviteUrl: respondUrl,
        expiresAt: maxIsoEndFromSlots(session.slots),
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
      url: respondUrl,
    });
    fireAndForgetLineMessagingForUser(
      participantUserId,
      [
        "MSA（日程調整）",
        "主催者（A）から日程の候補が届きました。",
        `開始日（トリガー）: ${session.triggerDateJst}`,
        "下のリンクから候補を選び、「確定」してください。",
        "",
        respondUrl,
      ].join("\n"),
    );

    {
      const persistErr = await persistSessionOrError(session);
      if (persistErr) return persistErr;
    }
    return NextResponse.json({ session });
  }

  if (body.action === "wizard_finalize") {
    if (session.status !== "awaiting_organizer_round1") {
      return NextResponse.json({ error: "invalid_status" }, { status: 409 });
    }
    if (!session.slots.length) {
      return NextResponse.json({ error: "build_slots_first" }, { status: 409 });
    }

    const participantUserId = cfgOrg.participantId;
    if (participantUserId === msaOrg.uid) {
      return NextResponse.json({ error: "participant_is_self" }, { status: 400 });
    }

    const all = session.slots.map((x) => x.id);
    session.organizerRound1Ids = all;
    session.participantIds = all;
    session.organizerFinalIds = all;
    session.status = "completed";
    session.finalizedAt = new Date().toISOString();
    session.emailSentAt = new Date().toISOString();
    session.participantUserId = participantUserId;

    const { calendarWarning } = await applyGoogleCalendarToSession(msaOrg.uid, session, all);

    const base = getAppBaseUrl();
    const inviteUrl = `${base}/p/${encodeURIComponent(session.participantToken)}`;

    const payload = buildParticipantInvitePayload(inviteUrl, {
      sessionId: session.id,
      slots: session.slots,
    });

    try {
      await insertInviteNotification({
        sessionId: session.id,
        recipientUserId: participantUserId,
        organizerUserId: msaOrg.uid,
        subject: payload.subject,
        textBody: payload.text,
        htmlBody: payload.html,
        inviteUrl,
        expiresAt: maxIsoEndFromSlots(session.slots),
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
    fireAndForgetLineMessagingForUser(
      participantUserId,
      [
        "MSA（日程調整）",
        "主催者（A）から日程の候補が届きました。",
        `開始日（トリガー）: ${session.triggerDateJst}`,
        "",
        inviteUrl,
      ].join("\n"),
    );

    {
      const persistErr = await persistSessionOrError(session);
      if (persistErr) return persistErr;
    }
    return NextResponse.json({
      session,
      ...(calendarWarning ? { calendarWarning } : {}),
    });
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
    {
      const persistErr = await persistSessionOrError(session);
      if (persistErr) return persistErr;
    }
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
    session.status = "completed";
    session.finalizedAt = new Date().toISOString();
    const { calendarWarning } = await applyGoogleCalendarToSession(
      msaOrg.uid,
      session,
      body.slotIds,
    );
    {
      const persistErr = await persistSessionOrError(session);
      if (persistErr) return persistErr;
    }
    return NextResponse.json({
      session,
      ...(calendarWarning ? { calendarWarning } : {}),
    });
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
    session.status = "completed";
    session.finalizedAt = new Date().toISOString();
    const { calendarWarning } = await applyGoogleCalendarToSession(
      msaOrg.uid,
      session,
      finalIds,
    );
    {
      const persistErr = await persistSessionOrError(session);
      if (persistErr) return persistErr;
    }
    return NextResponse.json({
      session,
      ...(calendarWarning ? { calendarWarning } : {}),
    });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
