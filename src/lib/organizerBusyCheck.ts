import { DateTime } from "luxon";

import { TIMEZONE } from "./constants";
import { rangeOverlapsAnyBusy } from "./calendarBusyMath";

/** ある日の [startHm, endHm] が Google busy（ISO 区間の配列）と重なるか */
export function ymdRangeOverlapsBusy(
  ymd: string,
  startHm: string,
  endHm: string,
  busy: { start: string; end: string }[],
): boolean {
  const parseHm = (s: string) => {
    const p = s.trim().split(":");
    const h = Number(p[0]);
    const m = Number(p[1] ?? 0);
    return { h, m };
  };
  const sh = parseHm(startHm);
  const eh = parseHm(endHm);
  const t0 = DateTime.fromISO(ymd, { zone: TIMEZONE })
    .set({ hour: sh.h, minute: sh.m, second: 0, millisecond: 0 })
    .toMillis();
  const t1 = DateTime.fromISO(ymd, { zone: TIMEZONE })
    .set({ hour: eh.h, minute: eh.m, second: 0, millisecond: 0 })
    .toMillis();
  if (t1 <= t0) return true;
  return rangeOverlapsAnyBusy(t0, t1, busy);
}
