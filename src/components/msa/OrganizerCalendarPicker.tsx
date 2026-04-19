"use client";

import { DateTime } from "luxon";
import { useMemo } from "react";

import { TIMEZONE } from "@/lib/constants";
import type { DayRememberSuggestion } from "@/lib/dayRemember";

export type CalendarViewMode = "week" | "month";

const WD_SHORT = ["月", "火", "水", "木", "金", "土", "日"];

function mondayOfWeekContaining(d: DateTime): DateTime {
  const x = d.setZone(TIMEZONE).startOf("day");
  const wd = x.weekday;
  return wd === 1 ? x : x.minus({ days: wd - 1 });
}

type Props = {
  eligibleYmd: Set<string>;
  /** Google カレンダー上、十分な空きが無いため選べない日（eligible の一部） */
  calendarBlockedYmd?: Set<string>;
  selectedYmd: Set<string>;
  onToggleYmd: (ymd: string) => void;
  viewMode: CalendarViewMode;
  onViewModeChange: (m: CalendarViewMode) => void;
  anchor: DateTime;
  onAnchorChange: (d: DateTime) => void;
  suggestions?: DayRememberSuggestion[];
  onApplySuggestion?: (s: DayRememberSuggestion) => void;
  /** 第1〜第3のどれを選んだか表示（光らせる） */
  highlightedSuggestionRank?: 1 | 2 | 3 | null;
};

export function OrganizerCalendarPicker({
  eligibleYmd,
  calendarBlockedYmd,
  selectedYmd,
  onToggleYmd,
  viewMode,
  onViewModeChange,
  anchor,
  onAnchorChange,
  suggestions,
  onApplySuggestion,
  highlightedSuggestionRank,
}: Props) {
  const blocked = calendarBlockedYmd ?? new Set<string>();

  const weekDays = useMemo(() => {
    const mon = mondayOfWeekContaining(anchor);
    return Array.from({ length: 7 }, (_, i) => mon.plus({ days: i }));
  }, [anchor]);

  const monthGrid = useMemo(() => {
    const a = anchor.setZone(TIMEZONE).startOf("month");
    const firstDow = a.weekday;
    const pad = firstDow === 7 ? 6 : firstDow - 1;
    const start = a.minus({ days: pad });
    const cells: DateTime[] = [];
    for (let i = 0; i < 42; i++) {
      cells.push(start.plus({ days: i }));
    }
    return { monthLabel: a.toFormat("y年M月"), cells };
  }, [anchor]);

  return (
    <div className="flex flex-col gap-4">
      {suggestions && suggestions.length > 0 && onApplySuggestion && (
        <div className="rounded-2xl border border-zinc-600/80 bg-zinc-900/50 p-4 ring-1 ring-zinc-800">
          <p className="text-[13px] leading-snug text-zinc-400">
            よく使う曜日・時間を提案しています。タップで日付と時間に反映されます。
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {suggestions.map((s) => {
              const active = highlightedSuggestionRank === s.rank;
              return (
                <li key={`${s.rank}-${s.dow}-${s.startMin}`}>
                  <button
                    type="button"
                    onClick={() => onApplySuggestion(s)}
                    className={
                      "w-full rounded-xl border px-4 py-4 text-left text-sm leading-relaxed transition " +
                      (active
                        ? "border-amber-400/90 bg-amber-950/50 text-zinc-50 shadow-[0_0_28px_rgba(251,191,36,0.38)] ring-2 ring-amber-400/85"
                        : "border-zinc-600/80 bg-zinc-950/80 text-zinc-200 hover:border-teal-500/60 hover:bg-teal-950/30")
                    }
                  >
                    <span className="font-semibold text-teal-300">第{s.rank}候補</span>
                    <span className="ml-2 block min-[400px]:ml-2 min-[400px]:inline">
                      {s.label}
                    </span>
                    {s.fromHistory && (
                      <span className="mt-1 block text-xs text-zinc-500 min-[400px]:ml-2 min-[400px]:inline">
                        （過去のカレンダー反映から）
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-zinc-600 bg-zinc-900 p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange("week")}
            className={
              "rounded-md px-3 py-1.5 text-xs font-medium " +
              (viewMode === "week"
                ? "bg-sky-600 text-white"
                : "text-zinc-400 hover:text-zinc-200")
            }
          >
            週
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("month")}
            className={
              "rounded-md px-3 py-1.5 text-xs font-medium " +
              (viewMode === "month"
                ? "bg-sky-600 text-white"
                : "text-zinc-400 hover:text-zinc-200")
            }
          >
            月
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (viewMode === "week") {
                onAnchorChange(anchor.minus({ weeks: 1 }));
              } else {
                onAnchorChange(anchor.minus({ months: 1 }));
              }
            }}
            className="rounded-lg border border-zinc-600 px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
            aria-label="前へ"
          >
            ‹
          </button>
          <span className="min-w-[8rem] text-center text-sm text-zinc-200">
            {viewMode === "week"
              ? `${weekDays[0].toFormat("M/d")}〜${weekDays[6].toFormat("M/d")}`
              : monthGrid.monthLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              if (viewMode === "week") {
                onAnchorChange(anchor.plus({ weeks: 1 }));
              } else {
                onAnchorChange(anchor.plus({ months: 1 }));
              }
            }}
            className="rounded-lg border border-zinc-600 px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
            aria-label="次へ"
          >
            ›
          </button>
        </div>
      </div>

      {viewMode === "week" && (
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {weekDays.map((d) => {
            const ymd = d.toISODate()!;
            const inEligible = eligibleYmd.has(ymd);
            const isBlocked = blocked.has(ymd);
            const canSelect = inEligible && !isBlocked;
            const sel = selectedYmd.has(ymd);
            const title = !inEligible
              ? "この日は候補の対象外です"
              : isBlocked
                ? "Google カレンダーの予定があり、この日は30分以上の空きがありません"
                : undefined;
            return (
              <button
                key={ymd}
                type="button"
                disabled={!canSelect}
                title={title}
                onClick={() => canSelect && onToggleYmd(ymd)}
                className={
                  "flex min-h-[4.75rem] flex-col items-center justify-center rounded-xl border px-1 py-2.5 text-center text-[11px] font-semibold sm:min-h-[5rem] sm:text-xs " +
                  (!inEligible
                    ? "cursor-not-allowed border-zinc-800 bg-zinc-950/50 text-zinc-600"
                    : isBlocked
                      ? "cursor-not-allowed border-orange-900/50 bg-orange-950/25 text-orange-200/70"
                      : sel
                        ? "border-sky-500 bg-sky-600/30 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                        : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:border-zinc-500")
                }
              >
                <span className="text-[10px] text-zinc-500">{WD_SHORT[d.weekday - 1]}</span>
                <span className="text-base">{d.day}</span>
              </button>
            );
          })}
        </div>
      )}

      {viewMode === "month" && (
        <div className="overflow-x-auto">
          <div className="grid grid-cols-7 gap-1 text-[10px] text-zinc-500 sm:text-xs">
            {WD_SHORT.map((w) => (
              <div key={w} className="py-1 text-center font-medium">
                {w}
              </div>
            ))}
            {monthGrid.cells.map((d) => {
              const ymd = d.toISODate()!;
              const inMonth = d.month === anchor.month;
              const inEligible = eligibleYmd.has(ymd);
              const isBlocked = blocked.has(ymd);
              const canSelect = inEligible && !isBlocked && inMonth;
              const sel = selectedYmd.has(ymd);
              const title = !inMonth
                ? undefined
                : !inEligible
                  ? "候補の対象外です"
                  : isBlocked
                    ? "Google カレンダーで空きがありません"
                    : undefined;
              return (
                <button
                  key={`${ymd}-m`}
                  type="button"
                  disabled={!inMonth || !inEligible || isBlocked}
                  title={title}
                  onClick={() => canSelect && onToggleYmd(ymd)}
                  className={
                    "flex h-11 items-center justify-center rounded-lg border text-xs font-semibold sm:h-12 " +
                    (!inMonth
                      ? "cursor-default border-transparent text-zinc-700 opacity-40"
                      : !inEligible
                        ? "cursor-not-allowed border-transparent text-zinc-700"
                        : isBlocked
                          ? "cursor-not-allowed border-orange-900/40 bg-orange-950/20 text-orange-200/80"
                          : sel
                            ? "border-sky-500 bg-sky-600/30 text-sky-100 shadow-[0_0_10px_rgba(56,189,248,0.2)]"
                            : "border-transparent bg-zinc-800/80 text-zinc-200 hover:border-zinc-500")
                  }
                >
                  {d.day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
