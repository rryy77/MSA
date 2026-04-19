import { DateTime } from "luxon";

import { busyMinutesOnDayJst, filterYmdWithNoFreeWindow } from "./calendarFreeWindows";
import { TIMEZONE } from "./constants";
import { ymdRangeOverlapsBusy } from "./organizerBusyCheck";
import type { Slot } from "./slots";
import { createServiceRoleClient } from "./supabase/service";

export type DayRememberEntry = {
  /** Luxon weekday 1=月 … 7=日 */
  dow: number;
  startMin: number;
  endMin: number;
  count: number;
};

type DayRememberJson = { entries: DayRememberEntry[] };

const DEFAULT_SHAPE: Omit<DayRememberEntry, "count">[] = [
  { dow: 6, startMin: 10 * 60, endMin: 12 * 60 },
  { dow: 3, startMin: 20 * 60, endMin: 22 * 60 },
  { dow: 7, startMin: 10 * 60, endMin: 12 * 60 },
];

function emptyJson(): DayRememberJson {
  return { entries: [] };
}

function entryKey(e: Pick<DayRememberEntry, "dow" | "startMin" | "endMin">): string {
  return `${e.dow}:${e.startMin}-${e.endMin}`;
}

function slotToEntry(slot: Slot): Pick<DayRememberEntry, "dow" | "startMin" | "endMin"> | null {
  const start = DateTime.fromISO(slot.start, { zone: TIMEZONE });
  const end = DateTime.fromISO(slot.end, { zone: TIMEZONE });
  if (!start.isValid || !end.isValid || end <= start) return null;
  return {
    dow: start.weekday,
    startMin: start.hour * 60 + start.minute,
    endMin: end.hour * 60 + end.minute,
  };
}

function normalizeJson(raw: unknown): DayRememberJson {
  if (!raw || typeof raw !== "object") return emptyJson();
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return emptyJson();
  const out: DayRememberEntry[] = [];
  for (const row of entries) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const dow = Number(r.dow);
    const startMin = Number(r.startMin);
    const endMin = Number(r.endMin);
    const count = Number(r.count);
    if (
      dow >= 1 &&
      dow <= 7 &&
      startMin >= 0 &&
      endMin > startMin &&
      endMin <= 24 * 60 &&
      count >= 1
    ) {
      out.push({ dow, startMin, endMin, count: Math.floor(count) });
    }
  }
  return { entries: out };
}

/** Google カレンダーに反映した確定枠から DAYREMEMBER を更新 */
export async function recordDayRememberSlots(userId: string, slots: Slot[]): Promise<void> {
  if (!slots.length) return;
  const service = createServiceRoleClient();
  if (!service) return;

  const { data, error } = await service
    .from("profiles")
    .select("day_remember")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (!String(error.message).includes("day_remember")) {
      console.warn("day_remember column:", error.message);
    }
    return;
  }

  let j = normalizeJson(data?.day_remember);
  const map = new Map<string, DayRememberEntry>();
  for (const e of j.entries) {
    map.set(entryKey(e), { ...e });
  }

  for (const slot of slots) {
    const p = slotToEntry(slot);
    if (!p) continue;
    const k = entryKey(p);
    const prev = map.get(k);
    if (prev) {
      map.set(k, { ...prev, count: prev.count + 1 });
    } else {
      map.set(k, { ...p, count: 1 });
    }
  }

  j = { entries: Array.from(map.values()) };

  const { error: upErr } = await service.from("profiles").update({ day_remember: j }).eq("id", userId);
  if (upErr) {
    console.error("day_remember update", upErr);
  }
}

const WD_JA = ["月", "火", "水", "木", "金", "土", "日"];

function formatSuggestionLabel(dow: number, startMin: number, endMin: number): string {
  const d = WD_JA[dow - 1] ?? "?";
  const sh = Math.floor(startMin / 60);
  const sm = startMin % 60;
  const eh = Math.floor(endMin / 60);
  const em = endMin % 60;
  const fmt = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;
  return `${d}曜日（時間:${fmt(sh, sm)}〜${fmt(eh, em)}）`;
}

export type DayRememberSuggestion = {
  rank: 1 | 2 | 3;
  label: string;
  dow: number;
  startMin: number;
  endMin: number;
  fromHistory: boolean;
  /** Google カレンダーと候補期間を踏まえて選んだ具体日（クライアントはこれを優先して適用） */
  suggestedYmd?: string;
};

/** 第1〜第3候補（履歴が足りないときは既定の曜日・時間帯で埋める） */
export function buildDayRememberSuggestions(entries: DayRememberEntry[]): DayRememberSuggestion[] {
  const sorted = [...entries].sort((a, b) => b.count - a.count);
  const used = new Set<string>();
  const out: DayRememberSuggestion[] = [];

  for (const e of sorted) {
    if (out.length >= 3) break;
    const k = entryKey(e);
    if (used.has(k)) continue;
    used.add(k);
    out.push({
      rank: (out.length + 1) as 1 | 2 | 3,
      label: formatSuggestionLabel(e.dow, e.startMin, e.endMin),
      dow: e.dow,
      startMin: e.startMin,
      endMin: e.endMin,
      fromHistory: true,
    });
  }

  let padIdx = 0;
  while (out.length < 3) {
    const d = DEFAULT_SHAPE[padIdx % DEFAULT_SHAPE.length];
    padIdx += 1;
    const k = entryKey(d);
    if (used.has(k)) continue;
    used.add(k);
    out.push({
      rank: (out.length + 1) as 1 | 2 | 3,
      label: formatSuggestionLabel(d.dow, d.startMin, d.endMin),
      dow: d.dow,
      startMin: d.startMin,
      endMin: d.endMin,
      fromHistory: false,
    });
  }

  return out.slice(0, 3) as DayRememberSuggestion[];
}

function mondayOfWeekContainingYmd(ymd: string): DateTime {
  const x = DateTime.fromISO(ymd, { zone: TIMEZONE }).startOf("day");
  const wd = x.weekday;
  return wd === 1 ? x : x.minus({ days: wd - 1 });
}

function formatSuggestionLabelWithYmd(ymd: string, startMin: number, endMin: number): string {
  const d = DateTime.fromISO(ymd, { zone: TIMEZONE });
  const wd = WD_JA[d.weekday - 1] ?? "?";
  const sh = Math.floor(startMin / 60);
  const sm = startMin % 60;
  const eh = Math.floor(endMin / 60);
  const em = endMin % 60;
  const fmt = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;
  return `${d.month}/${d.day}（${wd}） ${fmt(sh, sm)}〜${fmt(eh, em)}`;
}

/**
 * 候補期間の「先頭日のある週」を見て、提案曜日がその週で埋まっている・時間が被る場合は
 * 同一週で予定の少ない日付へ寄せる。足りなければ全体から最も空いている日へ。
 */
export function enrichDayRememberSuggestionsWithCalendar(
  base: DayRememberSuggestion[],
  busy: { start: string; end: string }[],
  eligibleSorted: string[],
): DayRememberSuggestion[] {
  if (!eligibleSorted.length) return base;
  const sorted = [...eligibleSorted].sort();
  const blockedSet = filterYmdWithNoFreeWindow(sorted, busy, 30);

  const monday = mondayOfWeekContainingYmd(sorted[0]);
  const sun = monday.plus({ days: 6 });
  const monIso = monday.toISODate()!;
  const sunIso = sun.toISODate()!;
  const inWeek = sorted.filter((ymd) => ymd >= monIso && ymd <= sunIso);

  const pad = (n: number) => String(n).padStart(2, "0");
  const toHm = (startMin: number, endMin: number) => {
    const sh = Math.floor(startMin / 60);
    const sm = startMin % 60;
    const eh = Math.floor(endMin / 60);
    const em = endMin % 60;
    return { startStr: `${pad(sh)}:${pad(sm)}`, endStr: `${pad(eh)}:${pad(em)}` };
  };

  return base.map((s) => {
    const { startStr, endStr } = toHm(s.startMin, s.endMin);

    let ymd: string | undefined;

    for (const d of inWeek) {
      if (blockedSet.has(d)) continue;
      const dt = DateTime.fromISO(d, { zone: TIMEZONE });
      if (dt.weekday !== s.dow) continue;
      if (ymdRangeOverlapsBusy(d, startStr, endStr, busy)) continue;
      ymd = d;
      break;
    }

    if (!ymd) {
      let best: { ymd: string; load: number } | null = null;
      for (const d of inWeek) {
        if (blockedSet.has(d)) continue;
        if (ymdRangeOverlapsBusy(d, startStr, endStr, busy)) continue;
        const load = busyMinutesOnDayJst(d, busy);
        if (!best || load < best.load) best = { ymd: d, load };
      }
      ymd = best?.ymd;
    }

    if (!ymd) {
      ymd = firstYmdMatchingWeekdaySkippingBlocked(sorted, s.dow, blockedSet);
      if (ymd && ymdRangeOverlapsBusy(ymd, startStr, endStr, busy)) {
        ymd = undefined;
      }
    }

    if (!ymd) {
      let best: { ymd: string; load: number } | null = null;
      for (const d of sorted) {
        if (blockedSet.has(d)) continue;
        if (ymdRangeOverlapsBusy(d, startStr, endStr, busy)) continue;
        const load = busyMinutesOnDayJst(d, busy);
        if (!best || load < best.load) best = { ymd: d, load };
      }
      ymd = best?.ymd;
    }

    if (!ymd) {
      return { ...s };
    }

    return {
      ...s,
      suggestedYmd: ymd,
      label: formatSuggestionLabelWithYmd(ymd, s.startMin, s.endMin),
    };
  });
}

/** eligible（昇順）のうち、最初に曜日が一致する日付 */
export function firstYmdMatchingWeekday(eligibleSorted: string[], dow: number): string | undefined {
  for (const ymd of eligibleSorted) {
    const d = DateTime.fromISO(ymd, { zone: TIMEZONE });
    if (d.isValid && d.weekday === dow) return ymd;
  }
  return undefined;
}

/** 曜日が一致し、かつ Google カレンダーで空きがないために除外された日を除く */
export function firstYmdMatchingWeekdaySkippingBlocked(
  eligibleSorted: string[],
  dow: number,
  calendarBlockedYmd: Set<string>,
): string | undefined {
  for (const ymd of eligibleSorted) {
    if (calendarBlockedYmd.has(ymd)) continue;
    const d = DateTime.fromISO(ymd, { zone: TIMEZONE });
    if (d.isValid && d.weekday === dow) return ymd;
  }
  return undefined;
}

export async function fetchDayRememberEntries(userId: string): Promise<DayRememberEntry[]> {
  const service = createServiceRoleClient();
  if (!service) return [];
  const { data, error } = await service
    .from("profiles")
    .select("day_remember")
    .eq("id", userId)
    .maybeSingle();
  if (error) return [];
  return normalizeJson(data?.day_remember).entries;
}
