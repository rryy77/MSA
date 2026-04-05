const STORAGE_KEY = "msa_invite_email_history";
const MAX_ENTRIES = 30;

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** ブラウザのみ。日程調整で送信した参加者メールを直近順で保持 */
export function getInviteEmailHistory(): string[] {
  if (typeof window === "undefined") return [];
  return parseList(window.localStorage.getItem(STORAGE_KEY));
}

export function rememberInviteEmail(email: string): void {
  if (typeof window === "undefined") return;
  const em = email.trim().toLowerCase();
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return;
  const prev = getInviteEmailHistory().filter((e) => e !== em);
  const next = [em, ...prev].slice(0, MAX_ENTRIES);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getDefaultInviteEmail(): string {
  const h = getInviteEmailHistory();
  return h[0] ?? "";
}
