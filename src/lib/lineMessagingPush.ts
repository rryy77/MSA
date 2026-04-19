import { fetchLineMessagingUserId } from "@/lib/inviteInbox";
import { createServiceRoleClient } from "@/lib/supabase/service";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
/** テキストメッセージは最大 5000 文字 */
const MAX_TEXT = 5000;

export function isLineMessagingPushEnvConfigured(): boolean {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim());
}

export async function sendLineMessagingPushMessage(
  lineUserId: string,
  text: string,
): Promise<void> {
  const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!channelToken) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN not set");
  }
  const trimmed = text.trim().slice(0, MAX_TEXT);
  if (!trimmed) return;

  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelToken}`,
    },
    body: JSON.stringify({
      to: lineUserId.trim(),
      messages: [{ type: "text", text: trimmed }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LINE Messaging API: HTTP ${res.status} ${t}`);
  }
}

/**
 * メール送信成功後、連携済みユーザーへ LINE でも通知。
 * service_role と LINE_CHANNEL_ACCESS_TOKEN が無い環境では何もしない。
 */
export function fireAndForgetLineMessagingForUser(
  appUserId: string,
  message: string,
): void {
  if (!isLineMessagingPushEnvConfigured()) return;

  const service = createServiceRoleClient();
  if (!service) return;

  void (async () => {
    try {
      const lineUid = await fetchLineMessagingUserId(appUserId);
      if (!lineUid?.trim()) return;
      await sendLineMessagingPushMessage(lineUid, message);
    } catch (e) {
      console.error("line_messaging_push", e);
    }
  })();
}
