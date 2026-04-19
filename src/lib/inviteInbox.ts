import { createServiceRoleClient } from "@/lib/supabase/service";

/** 予定の終了時刻を過ぎた受信トレイ行を削除するために使う（最大の slot.end の ISO） */
export function maxIsoEndFromSlots(slots: { end: string }[]): string | undefined {
  if (!slots.length) return undefined;
  return slots.reduce((a, s) => (s.end > a ? s.end : a), slots[0].end);
}

/** RLS を避けるため service_role のみで挿入（MSA ログインは Supabase Auth を使わない） */
export async function insertInviteNotification(input: {
  sessionId: string;
  recipientUserId: string;
  organizerUserId: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  inviteUrl: string;
  /** この時刻を過ぎたら一覧 API で自動削除（未指定なら削除されない） */
  expiresAt?: string;
}): Promise<void> {
  const service = createServiceRoleClient();
  if (!service) {
    throw new Error("invite_inbox: SUPABASE_SERVICE_ROLE_KEY が未設定です");
  }
  const { error } = await service.from("invite_notifications").insert({
    session_id: input.sessionId,
    recipient_user_id: input.recipientUserId,
    organizer_user_id: input.organizerUserId,
    subject: input.subject,
    text_body: input.textBody,
    html_body: input.htmlBody,
    invite_url: input.inviteUrl,
    expires_at: input.expiresAt ?? null,
  });
  if (error) throw new Error(`invite_inbox: ${error.message}`);
}

export async function fetchProfileEmail(userId: string): Promise<string | null> {
  const service = createServiceRoleClient();
  if (!service) throw new Error("profiles: SUPABASE_SERVICE_ROLE_KEY が未設定です");
  const { data, error } = await service
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  return data?.email ?? null;
}

function isMissingGoogleCalendarColumn(error: { message?: string }): boolean {
  const m = error.message ?? "";
  return (
    m.includes("google_calendar_refresh_token") &&
    (m.includes("does not exist") || m.includes("schema cache"))
  );
}

/** 登録済みプロフィールをメールで検索（大小文字を区別しない） */
export async function fetchGoogleCalendarRefreshToken(userId: string): Promise<string | null> {
  const service = createServiceRoleClient();
  if (!service) throw new Error("profiles: SUPABASE_SERVICE_ROLE_KEY が未設定です");
  const { data, error } = await service
    .from("profiles")
    .select("google_calendar_refresh_token")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingGoogleCalendarColumn(error)) {
      console.warn(
        "[MSA] profiles.google_calendar_refresh_token がありません。Supabase の SQL Editor で supabase/migrations/004_google_calendar_token.sql を実行してください。",
      );
      return null;
    }
    throw new Error(`profiles: ${error.message}`);
  }
  const t = data?.google_calendar_refresh_token;
  return typeof t === "string" && t.length > 0 ? t : null;
}

function isMissingLineMessagingUserIdColumn(error: { message?: string }): boolean {
  const m = error.message ?? "";
  return (
    m.includes("line_messaging_user_id") &&
    (m.includes("does not exist") || m.includes("schema cache"))
  );
}

/** LINE Messaging API の送信先 userId（LINE Login で保存） */
export async function fetchLineMessagingUserId(userId: string): Promise<string | null> {
  const service = createServiceRoleClient();
  if (!service) return null;
  const { data, error } = await service
    .from("profiles")
    .select("line_messaging_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingLineMessagingUserIdColumn(error)) {
      console.warn(
        "[MSA] profiles.line_messaging_user_id がありません。Supabase で supabase/migrations/008_profiles_line_messaging_user_id.sql を実行してください。",
      );
      return null;
    }
    throw new Error(`profiles: ${error.message}`);
  }
  const t = data?.line_messaging_user_id;
  return typeof t === "string" && t.length > 0 ? t : null;
}

export async function updateGoogleCalendarRefreshToken(
  userId: string,
  token: string | null,
): Promise<void> {
  const service = createServiceRoleClient();
  if (!service) throw new Error("profiles: SUPABASE_SERVICE_ROLE_KEY が未設定です");
  const { error } = await service
    .from("profiles")
    .update({ google_calendar_refresh_token: token })
    .eq("id", userId);
  if (error) {
    if (isMissingGoogleCalendarColumn(error)) {
      throw new Error(
        "データベースに google_calendar_refresh_token 列がありません。Supabase の SQL Editor で supabase/migrations/004_google_calendar_token.sql を実行してください。",
      );
    }
    throw new Error(`profiles: ${error.message}`);
  }
}

