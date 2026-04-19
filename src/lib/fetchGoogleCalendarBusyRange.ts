/**
 * FreeBusy API の1リクエスト上限に合わせ、期間を分割して取得して結合する。
 */
export async function fetchGoogleCalendarBusyMerged(
  fromIso: string,
  toIso: string,
  opts?: { credentials?: RequestCredentials },
): Promise<{ start: string; end: string }[]> {
  const t0 = new Date(fromIso).getTime();
  const t1 = new Date(toIso).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) return [];

  /** /api/google/calendar/busy の上限（約100日）より短めにチャンク */
  const chunkMs = 85 * 24 * 60 * 60 * 1000;
  const cred = opts?.credentials ?? "include";
  const all: { start: string; end: string }[] = [];

  let cur = t0;
  while (cur < t1) {
    const end = Math.min(cur + chunkMs, t1);
    const from = new Date(cur).toISOString();
    const to = new Date(end).toISOString();
    const r = await fetch(
      `/api/google/calendar/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { credentials: cred, cache: "no-store" },
    );
    if (!r.ok) {
      throw new Error(`busy_http_${r.status}`);
    }
    const j = (await r.json().catch(() => ({}))) as { busy?: { start: string; end: string }[] };
    all.push(...(j.busy ?? []));
    cur = end;
  }
  return all;
}
