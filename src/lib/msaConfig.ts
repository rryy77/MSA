/**
 * 2 名専用モード: 主催者 A / 参加者 B を環境変数で固定。
 * Supabase の auth.users に、A・B それぞれのユーザーと profiles を用意し、UUID を設定する。
 */

export type MsaConfig = {
  organizerId: string;
  participantId: string;
  organizerEmail: string;
  participantEmail: string;
};

let cached: MsaConfig | null = null;

export function getMsaConfig(): MsaConfig {
  if (cached) return cached;
  const organizerId = process.env.MSA_USER_A_ID?.trim();
  const participantId = process.env.MSA_USER_B_ID?.trim();
  const organizerEmail = process.env.MSA_USER_A_EMAIL?.trim().toLowerCase();
  const participantEmail = process.env.MSA_USER_B_EMAIL?.trim().toLowerCase();
  if (!organizerId || !participantId || !organizerEmail || !participantEmail) {
    throw new Error(
      "MSA_USER_A_ID, MSA_USER_B_ID, MSA_USER_A_EMAIL, MSA_USER_B_EMAIL がすべて必要です。",
    );
  }
  cached = { organizerId, participantId, organizerEmail, participantEmail };
  return cached;
}

export function tryGetMsaConfig(): MsaConfig | null {
  try {
    return getMsaConfig();
  } catch {
    return null;
  }
}

export function msaSessionSecret(): string {
  const s = process.env.MSA_SESSION_SECRET?.trim();
  if (!s || s.length < 16) {
    throw new Error("MSA_SESSION_SECRET は 16 文字以上で設定してください。");
  }
  return s;
}
