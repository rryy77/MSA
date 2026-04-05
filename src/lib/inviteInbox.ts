import type { SupabaseClient } from "@supabase/supabase-js";

export async function insertInviteNotification(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    recipientUserId: string;
    organizerUserId: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    inviteUrl: string;
  },
): Promise<void> {
  const { error } = await supabase.from("invite_notifications").insert({
    session_id: input.sessionId,
    recipient_user_id: input.recipientUserId,
    organizer_user_id: input.organizerUserId,
    subject: input.subject,
    text_body: input.textBody,
    html_body: input.htmlBody,
    invite_url: input.inviteUrl,
  });
  if (error) throw new Error(`invite_inbox: ${error.message}`);
}

export async function fetchProfileEmail(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  return data?.email ?? null;
}

/** LIKE の % _ をリテラル扱いする（メールに含まれても誤マッチしない） */
function escapeForILike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function isMissingGoogleCalendarColumn(error: { message?: string }): boolean {
  const m = error.message ?? "";
  return (
    m.includes("google_calendar_refresh_token") &&
    (m.includes("does not exist") || m.includes("schema cache"))
  );
}

/** 登録済みプロフィールをメールで検索（大小文字を区別しない） */
export async function fetchGoogleCalendarRefreshToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
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

export async function updateGoogleCalendarRefreshToken(
  supabase: SupabaseClient,
  userId: string,
  token: string | null,
): Promise<void> {
  const { error } = await supabase
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

export async function fetchProfileByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string | null } | null> {
  const normalized = email.trim().toLowerCase();
  const pattern = escapeForILike(normalized);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", pattern)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  return data ?? null;
}
