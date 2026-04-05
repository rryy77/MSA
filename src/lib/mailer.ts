import nodemailer from "nodemailer";
import { buildIcsCalendar } from "@/lib/ics";
import { buildScheduleHtmlList, buildSchedulePlainText } from "@/lib/scheduleEmail";
import type { Slot } from "@/lib/slots";

export type EmailAttachment = {
  filename: string;
  /** UTF-8 テキストまたはバイナリ */
  content: Buffer | string;
};

function toBase64(content: Buffer | string): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  return buf.toString("base64");
}

function smtpPassword(): string {
  return (
    process.env.SMTP_PASSWORD?.trim() ?? process.env.SMTP_PASS?.trim() ?? ""
  );
}

/** nodemailer の well-known 名（Gmail / iCloud など） */
function resolveNodemailerServiceName(): string | null {
  const raw = process.env.SMTP_SERVICE?.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "gmail" || lower === "googlemail") return "Gmail";
  if (lower === "icloud" || lower === "me" || lower === "mac") return "iCloud";
  return raw;
}

function smtpConfigured(): boolean {
  const user = process.env.SMTP_USER?.trim();
  const pass = smtpPassword();
  if (!user || !pass) return false;

  if (process.env.SMTP_HOST?.trim()) return true;

  const svc = resolveNodemailerServiceName();
  if (svc === "Gmail" || svc === "iCloud") return true;

  return false;
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return;

  const from =
    process.env.EMAIL_FROM?.trim() ?? "MSA <onboarding@resend.dev>";

  const replyTo = process.env.EMAIL_REPLY_TO?.trim();

  const body: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    text,
    html,
  };
  if (replyTo) {
    body.reply_to = replyTo;
  }
  if (attachments?.length) {
    body.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: toBase64(a.content),
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend: ${res.status} ${err}`);
  }
}

async function sendViaSmtp(
  to: string,
  subject: string,
  text: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<void> {
  if (!smtpConfigured()) return;

  const user = process.env.SMTP_USER!.trim();
  const pass = smtpPassword();
  const serviceName = resolveNodemailerServiceName();
  const host = process.env.SMTP_HOST?.trim();

  const replyTo = process.env.EMAIL_REPLY_TO?.trim();

  let transporter: nodemailer.Transporter;

  if (host) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure =
      process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true";
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  } else if (serviceName === "Gmail" || serviceName === "iCloud") {
    transporter = nodemailer.createTransport({
      service: serviceName,
      auth: { user, pass },
    });
  } else {
    return;
  }

  const from =
    process.env.EMAIL_FROM?.trim() ?? `MSA <${user}>`;

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: replyTo || undefined,
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content: typeof a.content === "string" ? Buffer.from(a.content, "utf-8") : a.content,
    })),
  });
}

/** Resend / SMTP のいずれかが必須。未設定なら例外。 */
async function sendTransactionalOrThrow(
  to: string,
  subject: string,
  text: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<void> {
  if (process.env.RESEND_API_KEY?.trim()) {
    await sendViaResend(to, subject, text, html, attachments);
    return;
  }
  if (smtpConfigured()) {
    await sendViaSmtp(to, subject, text, html, attachments);
    return;
  }
  throw new Error("MAIL_NOT_CONFIGURED");
}

const ICS_FILENAME = "msa-schedule.ics";

export type ParticipantInvitePayload = {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
};

/** メール本文・添付（DB の受信トレイや送信で共通利用） */
export function buildParticipantInvitePayload(
  inviteUrl: string,
  opts: { sessionId: string; slots: Slot[] },
): ParticipantInvitePayload {
  const { sessionId, slots } = opts;
  const scheduleText = buildSchedulePlainText(slots);
  const scheduleHtml = buildScheduleHtmlList(slots);
  const ics = buildIcsCalendar(slots, sessionId);
  const attachments: EmailAttachment[] = [
    { filename: ICS_FILENAME, content: ics },
  ];

  const subject = "MSA 日程調整のご案内（日程確定）";
  const text = `${scheduleText}

詳細・確認は次の URL から開いてください。

${inviteUrl}

カレンダー取り込み用に「${ICS_FILENAME}」を添付しています。
心当たりがない場合はこのメールを破棄してください。`;

  const safeHref = inviteUrl.replace(/"/g, "&quot;");
  const html = `
    ${scheduleHtml}
    <p style="margin:16px 0 8px">詳細・確認は次のボタンからどうぞ。</p>
    <p><a href="${safeHref}" style="display:inline-block;margin:12px 0;padding:10px 16px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">日程調整ページを開く</a></p>
    <p style="color:#666;font-size:0.9rem">カレンダーアプリへ取り込むには、添付の「${ICS_FILENAME}」をご利用ください。</p>
    <p style="color:#666;font-size:0.85rem">心当たりがない場合はこのメールを破棄してください。</p>
  `;
  return { subject, text, html, attachments };
}

/**
 * 参加者へ確定日程・ICS・参加用 URL をメール送信（Resend / SMTP 必須）。
 */
export async function sendParticipantInviteEmail(
  to: string,
  inviteUrl: string,
  opts: { sessionId: string; slots: Slot[] },
): Promise<void> {
  const { subject, text, html, attachments } = buildParticipantInvitePayload(
    inviteUrl,
    opts,
  );
  await sendTransactionalOrThrow(to, subject, text, html, attachments);
}

/** 参加者が候補を返信したあと、主催者へ：参加者が選んだ枠のみ（一覧・ICS・開く URL） */
export function buildOrganizerParticipantRepliedPayload(
  sessionUrl: string,
  opts: { sessionId: string; participantSlots: Slot[] },
): ParticipantInvitePayload {
  const { sessionId, participantSlots } = opts;
  const scheduleText = buildSchedulePlainText(
    participantSlots,
    "参加者が選んだ候補は次のとおりです。",
  );
  const scheduleHtml = buildScheduleHtmlList(
    participantSlots,
    "参加者が選んだ候補は次のとおりです。",
  );
  const ics =
    participantSlots.length > 0 ? buildIcsCalendar(participantSlots, sessionId) : "";
  const attachments: EmailAttachment[] =
    participantSlots.length > 0
      ? [{ filename: ICS_FILENAME, content: ics }]
      : [];

  const subject = "MSA 参加者が日程候補を返信しました";
  const text = `${scheduleText}

詳細・確認は次の URL から開いてください。

${sessionUrl}

カレンダー取り込み用に「${ICS_FILENAME}」を添付しています。
心当たりがない場合はこのメールを破棄してください。`;

  const safeHref = sessionUrl.replace(/"/g, "&quot;");
  const html = `
    ${scheduleHtml}
    <p style="margin:16px 0 8px">詳細・確認は次のボタンからどうぞ。</p>
    <p><a href="${safeHref}" style="display:inline-block;margin:12px 0;padding:10px 16px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">日程調整ページを開く</a></p>
    ${participantSlots.length ? `<p style="color:#666;font-size:0.9rem">カレンダーアプリへ取り込むには、添付の「${ICS_FILENAME}」をご利用ください。</p>` : ""}
    <p style="color:#666;font-size:0.85rem">心当たりがない場合はこのメールを破棄してください。</p>
  `;
  return { subject, text, html, attachments };
}

export async function sendOrganizerParticipantRepliedEmail(
  to: string,
  sessionUrl: string,
  opts: { sessionId: string; participantSlots: Slot[] },
): Promise<void> {
  const { subject, text, html, attachments } = buildOrganizerParticipantRepliedPayload(
    sessionUrl,
    opts,
  );
  await sendTransactionalOrThrow(to, subject, text, html, attachments);
}

/** 実際に外部へ送っているか（UI メッセージ用） */
export function isOutboundEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim()) || smtpConfigured();
}
