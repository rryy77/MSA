/**
 * 2 名専用モード: 主催者 A / 参加者 B を UUID のみで固定（メールアドレスは不要）。
 * Supabase の auth.users に A・B のユーザーと profiles を用意し、ID を設定する。
 */

export type MsaConfig = {
  organizerId: string;
  participantId: string;
};

let cached: MsaConfig | null = null;

export function getMsaConfig(): MsaConfig {
  if (cached) return cached;
  const organizerId = process.env.MSA_USER_A_ID?.trim();
  const participantId = process.env.MSA_USER_B_ID?.trim();
  if (!organizerId || !participantId) {
    throw new Error("MSA_USER_A_ID と MSA_USER_B_ID が必要です。");
  }
  cached = { organizerId, participantId };
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
