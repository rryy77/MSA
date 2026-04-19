import { DateTime } from "luxon";

import { TIMEZONE } from "./constants";

function mergeMsIntervals(intervals: { start: number; end: number }[]): { start: number; end: number }[] {
  if (intervals.length === 0) return [];
  const s = [...intervals].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (!last || x.start > last.end) out.push({ ...x });
    else last.end = Math.max(last.end, x.end);
  }
  return out;
}

export function mergeBusyIntervalsIso(
  busy: { start: string; end: string }[],
): { start: number; end: number }[] {
  const arr = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((x) => !Number.isNaN(x.start) && !Number.isNaN(x.end) && x.end > x.start);
  return mergeMsIntervals(arr);
}

/**
 * その JST 暦日に、連続して minFreeMinutes 分以上の「予定なし」枠が存在するか。
 * Google FreeBusy の busy 区間（UTC ISO）を前提に、日境界でクリップする。
 */
export function dayHasAtLeastFreeMinutes(
  ymd: string,
  busy: { start: string; end: string }[],
  minFreeMinutes: number,
): boolean {
  const day0 = DateTime.fromISO(ymd, { zone: TIMEZONE }).startOf("day");
  if (!day0.isValid) return false;
  const d0 = day0.toMillis();
  const d1 = day0.plus({ days: 1 }).toMillis();
  const need = minFreeMinutes * 60 * 1000;

  const merged = mergeBusyIntervalsIso(busy);
  const clipped: { start: number; end: number }[] = [];
  for (const b of merged) {
    const s = Math.max(b.start, d0);
    const e = Math.min(b.end, d1);
    if (e > s) clipped.push({ start: s, end: e });
  }
  const m2 = mergeMsIntervals(clipped);

  let cursor = d0;
  for (const b of m2) {
    if (b.start - cursor >= need) return true;
    cursor = Math.max(cursor, b.end);
  }
  return d1 - cursor >= need;
}

/** 候補日リストのうち、minFreeMinutes 分以上の空きが無い日を列挙 */
export function filterYmdWithNoFreeWindow(
  ymdList: string[],
  busy: { start: string; end: string }[],
  minFreeMinutes: number,
): Set<string> {
  const blocked = new Set<string>();
  for (const ymd of ymdList) {
    if (!dayHasAtLeastFreeMinutes(ymd, busy, minFreeMinutes)) blocked.add(ymd);
  }
  return blocked;
}

/** その JST 暦日にかかる busy の合計（分）。週内の「空き具合」比較用 */
export function busyMinutesOnDayJst(ymd: string, busy: { start: string; end: string }[]): number {
  const day0 = DateTime.fromISO(ymd, { zone: TIMEZONE }).startOf("day");
  if (!day0.isValid) return 0;
  const d0 = day0.toMillis();
  const d1 = day0.plus({ days: 1 }).toMillis();
  const merged = mergeBusyIntervalsIso(busy);
  let totalMs = 0;
  for (const b of merged) {
    const s = Math.max(b.start, d0);
    const e = Math.min(b.end, d1);
    if (e > s) totalMs += e - s;
  }
  return Math.round(totalMs / (60 * 1000));
}
