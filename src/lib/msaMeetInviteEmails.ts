/**
 * 日程確定時に Google カレンダーへ追加する Meet 付き予定の「固定招待先」。
 * カンマ区切り（例: a@example.com,b@example.com）。主催者・参加者など、環境ごとに固定でよい宛先を列挙する。
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getMsaFixedMeetInviteEmails(): string[] {
  const raw = process.env.MSA_GOOGLE_CALENDAR_MEET_ATTENDEES ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const e = part.trim();
    if (!e || !EMAIL_RE.test(e)) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
