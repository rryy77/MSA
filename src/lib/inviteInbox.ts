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

/** 登録済みプロフィールをメールで検索（大小文字を区別しない） */
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
