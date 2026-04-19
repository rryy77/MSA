/**
 * ユーザーの [start,end] が busy 区間のいずれかと重なるか（端点は重ならない扱いで調整済みの ISO を想定）。
 */
export function rangeOverlapsAnyBusy(
  rangeStartMs: number,
  rangeEndMs: number,
  busy: { start: string; end: string }[],
): boolean {
  if (rangeEndMs <= rangeStartMs) return true;
  for (const b of busy) {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    if (Number.isNaN(bs) || Number.isNaN(be)) continue;
    if (rangeStartMs < be && bs < rangeEndMs) return true;
  }
  return false;
}
