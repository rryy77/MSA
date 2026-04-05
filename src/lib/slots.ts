import { DateTime } from "luxon";
import { TIMEZONE } from "./constants";

export type Slot = {
  id: string;
  start: string;
  end: string;
  label: string;
};

const WINDOWS: { startHour: number; startMinute: number; endHour: number; endMinute: number }[] = [
  { startHour: 19, startMinute: 0, endHour: 20, endMinute: 0 },
  { startHour: 20, startMinute: 0, endHour: 21, endMinute: 0 },
];

export function buildSlotsForDates(ymdList: string[]): Slot[] {
  const slots: Slot[] = [];
  for (const ymd of ymdList) {
    const day = DateTime.fromISO(ymd, { zone: TIMEZONE });
    if (!day.isValid) continue;
    WINDOWS.forEach((w, idx) => {
      const start = day.set({ hour: w.startHour, minute: w.startMinute, second: 0, millisecond: 0 });
      const end = day.set({ hour: w.endHour, minute: w.endMinute, second: 0, millisecond: 0 });
      const id = `${ymd}_${String(w.startHour).padStart(2, "0")}${String(w.startMinute).padStart(2, "0")}_${idx}`;
      slots.push({
        id,
        start: start.toISO()!,
        end: end.toISO()!,
        label: `${ymd} ${String(w.startHour).padStart(2, "0")}:${String(w.startMinute).padStart(2, "0")}–${String(w.endHour).padStart(2, "0")}:${String(w.endMinute).padStart(2, "0")}`,
      });
    });
  }
  return slots;
}

export function buildSlotsFromSchedule(dates: string[], timeStart: string, timeEnd: string): Slot[] {
  const parseHm = (s: string) => {
    const parts = s.trim().split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1] ?? 0);
    return { h, m };
  };
  const sh = parseHm(timeStart);
  const eh = parseHm(timeEnd);
  const slotsOut: Slot[] = [];
  for (const ymd of [...dates].sort()) {
    const day = DateTime.fromISO(ymd, { zone: TIMEZONE });
    if (!day.isValid) continue;
    const start = day.set({ hour: sh.h, minute: sh.m, second: 0, millisecond: 0 });
    const end = day.set({ hour: eh.h, minute: eh.m, second: 0, millisecond: 0 });
    if (end <= start) continue;
    const id = `${ymd}_t_${timeStart.replace(":", "")}_${timeEnd.replace(":", "")}`;
    slotsOut.push({
      id,
      start: start.toISO()!,
      end: end.toISO()!,
      label: `${ymd} ${timeStart}–${timeEnd} (JST)`,
    });
  }
  return slotsOut;
}

export function buildSlotsDetailed(
  items: { ymd: string; timeStart: string; timeEnd: string }[],
): Slot[] {
  const parseHm = (s: string) => {
    const parts = s.trim().split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1] ?? 0);
    return { h, m };
  };
  const out: Slot[] = [];
  for (const { ymd, timeStart, timeEnd } of items) {
    const sh = parseHm(timeStart);
    const eh = parseHm(timeEnd);
    const day = DateTime.fromISO(ymd, { zone: TIMEZONE });
    if (!day.isValid) continue;
    const start = day.set({ hour: sh.h, minute: sh.m, second: 0, millisecond: 0 });
    const end = day.set({ hour: eh.h, minute: eh.m, second: 0, millisecond: 0 });
    if (end <= start) continue;
    const id = `${ymd}_${timeStart.replace(":", "")}_${timeEnd.replace(":", "")}_${out.length}`;
    out.push({
      id,
      start: start.toISO()!,
      end: end.toISO()!,
      label: `${ymd} ${timeStart}–${timeEnd} (JST)`,
    });
  }
  return out;
}
