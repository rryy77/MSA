import webpush from "web-push";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type PushPayload = {
  title: string;
  body: string;
  /** 通知クリックで開くパスまたは絶対 URL */
  url: string;
};

let vapidReady = false;

function ensureVapid(): boolean {
  if (vapidReady) return true;
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject =
    process.env.WEB_PUSH_SUBJECT?.trim() ?? "mailto:localhost@example.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

/** 送信に必要な VAPID・サービスロールが揃っているか */
export function isWebPushSendConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim() &&
      process.env.WEB_PUSH_PRIVATE_KEY?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/**
 * 指定ユーザーに登録されている端末へ Web Push（OS 通知の元）を送る。
 * 他ユーザーの購読を読むため SUPABASE_SERVICE_ROLE_KEY が必須。
 */
export async function sendWebPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!isWebPushSendConfigured() || !ensureVapid()) {
    return;
  }
  const supabase = createServiceRoleClient();
  if (!supabase) return;

  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    console.error("push_subscriptions fetch:", error.message);
    return;
  }
  if (!rows?.length) return;

  const body = JSON.stringify(payload);

  for (const row of rows) {
    const sub = {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    };
    try {
      await webpush.sendNotification(sub, body, {
        TTL: 86_400,
        urgency: "high",
      });
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
      } else {
        console.error("webpush.sendNotification:", err);
      }
    }
  }
}

export function fireAndForgetPush(
  userId: string | undefined,
  payload: PushPayload,
): void {
  if (!userId) return;
  void sendWebPushToUser(userId, payload).catch((e) =>
    console.error("fireAndForgetPush", e),
  );
}
