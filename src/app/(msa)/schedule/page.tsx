"use client";

import { DateTime } from "luxon";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  OrganizerCalendarPicker,
  type CalendarViewMode,
} from "@/components/msa/OrganizerCalendarPicker";
import { TIMEZONE } from "@/lib/constants";
import { filterYmdWithNoFreeWindow } from "@/lib/calendarFreeWindows";
import {
  firstYmdMatchingWeekdaySkippingBlocked,
  type DayRememberSuggestion,
  type SetReservationSuggestion,
  type TimeRememberSuggestion,
} from "@/lib/dayRemember";
import { getSelectableDatesJstYear } from "@/lib/dateRange";
import { fetchGoogleCalendarBusyMerged } from "@/lib/fetchGoogleCalendarBusyRange";
import { ymdRangeOverlapsBusy } from "@/lib/organizerBusyCheck";

const WD_LABEL = ["", "月", "火", "水", "木", "金", "土", "日"];

function formatYmdChip(ymd: string): string {
  const d = DateTime.fromISO(ymd, { zone: TIMEZONE });
  if (!d.isValid) return ymd;
  return `${d.month}/${d.day}（${WD_LABEL[d.weekday]}）`;
}

function confirmOverlapProceed(ymd: string, startHm: string, endHm: string): boolean {
  return window.confirm(
    `${formatYmdChip(ymd)} ${startHm}〜${endHm} には既存の予定があります。このまま重ねて作成しますか？`,
  );
}

type Step = "menu" | "pickDates" | "times" | "review" | "confirm";

type Summary = { id: string; status: string; triggerDateJst: string; triggerAt: string };

function ScheduleWizard() {
  const [buildMode, setBuildMode] = useState<"set" | "select">("select");
  const [step, setStep] = useState<Step>("menu");
  const [eligibleDates, setEligibleDates] = useState<string[]>([]);
  const eligibleSet = useMemo(() => new Set(eligibleDates), [eligibleDates]);
  const [selectedYmd, setSelectedYmd] = useState<Set<string>>(new Set());
  const [concreteDates, setConcreteDates] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, { start: string; end: string }>>({});
  const [calendarBusy, setCalendarBusy] = useState<{ start: string; end: string }[]>([]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [anchor, setAnchor] = useState(() => DateTime.now().setZone(TIMEZONE).startOf("day"));
  const [suggestions, setSuggestions] = useState<DayRememberSuggestion[]>([]);
  const [timeSuggestions, setTimeSuggestions] = useState<TimeRememberSuggestion[]>([]);
  const [setReservationSuggestions, setSetSuggestions] = useState<SetReservationSuggestion[]>([]);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  /** 30分以上の空きが無い日（Google 予定で埋まっている） */
  const [calendarBlockedYmd, setCalendarBlockedYmd] = useState<Set<string>>(new Set());
  const [busyPickLoading, setBusyPickLoading] = useState(false);
  /** 日付除外計算用の FreeBusy（候補タップ時の重なり判定にも使用） */
  const [pickStepBusy, setPickStepBusy] = useState<{ start: string; end: string }[]>([]);
  /** DAYREMEMBER 第1〜3がそれぞれどの日付に紐づいているか（単一情報源。ここからハイライトを派生） */
  const [suggestionRankToYmd, setSuggestionRankToYmd] = useState<Partial<Record<1 | 2 | 3, string>>>(
    {},
  );
  const [setSuggestionIdToYmd, setSetSuggestionIdToYmd] = useState<Record<string, string>>({});

  const highlightedSuggestionRanks = useMemo(
    () => new Set(([1, 2, 3] as const).filter((r) => Boolean(suggestionRankToYmd[r]))),
    [suggestionRankToYmd],
  );

  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Summary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const searchParams = useSearchParams();
  const [actorRole, setActorRole] = useState<"organizer" | "participant" | null>(null);

  useEffect(() => {
    fetch("/api/msa/session", { credentials: "include" })
      .then((r) => r.json())
      .then((j: { role?: string }) => {
        setActorRole(j.role === "organizer" ? "organizer" : j.role === "participant" ? "participant" : null);
      })
      .catch(() => setActorRole(null));
  }, []);

  useEffect(() => {
    if (searchParams.get("view") === "confirm") {
      setStep("confirm");
    }
  }, [searchParams]);

  useEffect(() => {
    setEligibleDates(getSelectableDatesJstYear(new Date()));
  }, []);

  const refreshGoogleStatus = useCallback(async () => {
    const r = await fetch("/api/google/calendar/status", { credentials: "include", cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { connected?: boolean };
    setGoogleConnected(Boolean(j.connected));
  }, []);

  useEffect(() => {
    void refreshGoogleStatus();
  }, [refreshGoogleStatus]);

  const loadSessions = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/sessions", {
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (step === "confirm") loadSessions();
  }, [step, loadSessions]);

  useEffect(() => {
    if (step !== "pickDates" || !eligibleDates.length) return;
    void (async () => {
      const r = await fetch("/api/msa/day-remember", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eligibleDates }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        suggestions?: DayRememberSuggestion[];
        timeSuggestions?: TimeRememberSuggestion[];
        setSuggestions?: SetReservationSuggestion[];
      };
      setSuggestions(j.suggestions ?? []);
      setTimeSuggestions(j.timeSuggestions ?? []);
      setSetSuggestions(j.setSuggestions ?? []);
    })();
  }, [step, eligibleDates]);

  useEffect(() => {
    if (step !== "pickDates" || !eligibleDates.length || !googleConnected) {
      setCalendarBlockedYmd(new Set());
      setPickStepBusy([]);
      return;
    }
    let cancelled = false;
    setBusyPickLoading(true);
    void (async () => {
      try {
        const sorted = [...eligibleDates].sort();
        const from = DateTime.fromISO(sorted[0], { zone: TIMEZONE }).startOf("day").toISO()!;
        const to = DateTime.fromISO(sorted[sorted.length - 1], { zone: TIMEZONE }).endOf("day").toISO()!;
        const busy = await fetchGoogleCalendarBusyMerged(from, to);
        if (cancelled) return;
        setPickStepBusy(busy);
        setCalendarBlockedYmd(filterYmdWithNoFreeWindow(eligibleDates, busy, 30));
      } catch {
        if (!cancelled) {
          setCalendarBlockedYmd(new Set());
          setPickStepBusy([]);
        }
      } finally {
        if (!cancelled) setBusyPickLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, eligibleDates, googleConnected]);

  useEffect(() => {
    setSelectedYmd((prev) => {
      const next = new Set([...prev].filter((ymd) => !calendarBlockedYmd.has(ymd)));
      return next.size === prev.size && [...next].every((y) => prev.has(y)) ? prev : next;
    });
    setSuggestionRankToYmd((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const r of [1, 2, 3] as const) {
        const y = next[r];
        if (y && calendarBlockedYmd.has(y)) {
          delete next[r];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [calendarBlockedYmd]);

  function toggleYmd(ymd: string) {
    setSelectedYmd((prev) => {
      const n = new Set(prev);
      if (n.has(ymd)) {
        n.delete(ymd);
        setSuggestionRankToYmd((sr) => {
          const nx = { ...sr };
          for (const rank of [1, 2, 3] as const) {
            if (nx[rank] === ymd) delete nx[rank];
          }
          return nx;
        });
        setTimes((t) => {
          const { [ymd]: _, ...rest } = t;
          return rest;
        });
        setSetSuggestionIdToYmd((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (next[k] === ymd) delete next[k];
          }
          return next;
        });
      } else {
        n.add(ymd);
      }
      return n;
    });
  }

  async function startPickDates(mode: "set" | "select") {
    setError(null);
    await refreshGoogleStatus();
    const r = await fetch("/api/google/calendar/status", { credentials: "include", cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { connected?: boolean };
    if (!j.connected) {
      setError(
        "日程作成の前に、設定で Google カレンダーと連携してください（予定のある時間帯を避けるため）。",
      );
      return;
    }
    setGoogleConnected(true);
    setBuildMode(mode);
    setSelectedYmd(new Set());
    setSuggestionRankToYmd({});
    setSetSuggestionIdToYmd({});
    setStep("pickDates");
  }

  function applySuggestion(s: DayRememberSuggestion) {
    if (suggestionRankToYmd[s.rank]) {
      const ymd = suggestionRankToYmd[s.rank]!;
      setSuggestionRankToYmd((prev) => {
        const next = { ...prev };
        delete next[s.rank];
        return next;
      });
      setSelectedYmd((prev) => {
        const n = new Set(prev);
        n.delete(ymd);
        return n;
      });
      setTimes((prev) => {
        const { [ymd]: _, ...rest } = prev;
        return rest;
      });
      setError(null);
      return;
    }
    const sorted = [...eligibleDates].sort();
    const ymd =
      s.suggestedYmd ??
      firstYmdMatchingWeekdaySkippingBlocked(sorted, s.dow, calendarBlockedYmd);
    if (!ymd) {
      setError("この曜日で選べる空き日がありません（Google カレンダーの予定で埋まっています）。");
      return;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const sh = Math.floor(s.startMin / 60);
    const sm = s.startMin % 60;
    const eh = Math.floor(s.endMin / 60);
    const em = s.endMin % 60;
    const startStr = `${pad(sh)}:${pad(sm)}`;
    const endStr = `${pad(eh)}:${pad(em)}`;
    if (ymdRangeOverlapsBusy(ymd, startStr, endStr, pickStepBusy) && !confirmOverlapProceed(ymd, startStr, endStr)) {
      setError("この候補の適用をキャンセルしました。");
      return;
    }
    setSuggestionRankToYmd((prev) => ({ ...prev, [s.rank]: ymd }));
    setSelectedYmd((prev) => new Set(prev).add(ymd));
    setTimes((prev) => ({
      ...prev,
      [ymd]: { start: startStr, end: endStr },
    }));
    setError(null);
  }

  function applySetSuggestion(s: SetReservationSuggestion) {
    const current = setSuggestionIdToYmd[s.id];
    if (current) {
      setSetSuggestionIdToYmd((prev) => {
        const next = { ...prev };
        delete next[s.id];
        return next;
      });
      setSelectedYmd((prev) => {
        const n = new Set(prev);
        n.delete(current);
        return n;
      });
      setTimes((prev) => {
        const { [current]: _, ...rest } = prev;
        return rest;
      });
      return;
    }
    const sorted = [...eligibleDates].sort();
    const ymd = firstYmdMatchingWeekdaySkippingBlocked(sorted, s.dow, calendarBlockedYmd);
    if (!ymd) {
      setError("この曜日で選べる空き日がありません。");
      return;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const st = `${pad(Math.floor(s.startMin / 60))}:${pad(s.startMin % 60)}`;
    const en = `${pad(Math.floor(s.endMin / 60))}:${pad(s.endMin % 60)}`;
    setSetSuggestionIdToYmd((prev) => ({ ...prev, [s.id]: ymd }));
    setSelectedYmd((prev) => new Set(prev).add(ymd));
    setTimes((prev) => ({ ...prev, [ymd]: { start: st, end: en } }));
    setError(null);
  }

  async function goTimes() {
    if (selectedYmd.size === 0) {
      setError("日付を1つ以上選んでください");
      return;
    }
    setError(null);
    const dates = Array.from(selectedYmd).sort();
    if (buildMode === "set") {
      setConcreteDates(dates);
      setTimes((prev) => {
        const next = { ...prev };
        for (const ymd of dates) {
          if (!next[ymd]) next[ymd] = { start: "19:00", end: "20:00" };
        }
        return next;
      });
      setStep("review");
      return;
    }
    setConcreteDates(dates);
    setTimes((prev) => {
      const next = { ...prev };
      for (const ymd of dates) {
        if (!next[ymd]) next[ymd] = { start: "19:00", end: "20:00" };
      }
      return next;
    });

    const from = DateTime.fromISO(dates[0], { zone: TIMEZONE }).startOf("day").toISO()!;
    const to = DateTime.fromISO(dates[dates.length - 1], { zone: TIMEZONE }).endOf("day").toISO()!;
    const br = await fetch(
      `/api/google/calendar/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!br.ok) {
      const ej = (await br.json().catch(() => ({}))) as { error?: string };
      setCalendarBusy([]);
      setError(
        ej.error === "google_calendar_not_connected"
          ? "Google カレンダーが未連携です。設定から連携してください。"
          : "Google カレンダーの予定を取得できませんでした。",
      );
      return;
    }
    const bj = (await br.json().catch(() => ({}))) as { busy?: { start: string; end: string }[] };
    setCalendarBusy(bj.busy ?? []);
    setStep("times");
  }

  function setRange(ymd: string, field: "start" | "end", value: string) {
    setSuggestionRankToYmd((prev) => {
      const next = { ...prev };
      for (const rank of [1, 2, 3] as const) {
        if (next[rank] === ymd) delete next[rank];
      }
      return next;
    });
    setTimes((prev) => ({
      ...prev,
      [ymd]: { ...prev[ymd], [field]: value },
    }));
  }

  function applyTimeSuggestionToDate(ymd: string, s: TimeRememberSuggestion) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const st = `${pad(Math.floor(s.startMin / 60))}:${pad(s.startMin % 60)}`;
    const en = `${pad(Math.floor(s.endMin / 60))}:${pad(s.endMin % 60)}`;
    setRange(ymd, "start", st);
    setRange(ymd, "end", en);
  }

  function firstBusyOverlap(): { ymd: string; start: string; end: string } | null {
    for (const ymd of concreteDates) {
      const st = times[ymd]?.start ?? "19:00";
      const en = times[ymd]?.end ?? "20:00";
      if (ymdRangeOverlapsBusy(ymd, st, en, calendarBusy)) {
        return { ymd, start: st, end: en };
      }
    }
    return null;
  }

  function goReview() {
    const overlap = firstBusyOverlap();
    if (overlap && !confirmOverlapProceed(overlap.ymd, overlap.start, overlap.end)) {
      setError("重複している予定の作成をキャンセルしました。");
      return;
    }
    setError(null);
    setStep("review");
  }

  async function submitWizard() {
    const overlap = firstBusyOverlap();
    if (overlap && !confirmOverlapProceed(overlap.ymd, overlap.start, overlap.end)) {
      setError("重複している予定の作成をキャンセルしました。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const items = concreteDates.map((ymd) => ({
        ymd,
        timeStart: times[ymd]?.start ?? "19:00",
        timeEnd: times[ymd]?.end ?? "20:00",
      }));
      const cr = await fetch("/api/sessions", {
        method: "POST",
        credentials: "include",
      });
      const created = await cr.json().catch(() => ({}));
      if (!cr.ok) {
        const msg =
          typeof created.message === "string"
            ? created.message
            : "日程の作成に失敗しました（サーバー設定を確認してください）";
        throw new Error(msg);
      }
      const id = created.session?.id as string;
      if (!id) throw new Error("no_id");
      const pr = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "build_slots", items }),
      });
      if (!pr.ok) {
        const pj = (await pr.json().catch(() => ({}))) as { message?: string };
        throw new Error(pj.message ?? "候補の保存に失敗しました");
      }
      router.push(`/session/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。もう一度お試しください。");
    } finally {
      setPending(false);
    }
  }

  if (actorRole === "participant") {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-6">
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← メッセージに戻る
        </Link>
        <p className="rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-6 text-sm text-zinc-300">
          予定の作成は主催者（A）のみです。ログインを切り替える場合は設定からログアウトしてください。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 pb-6">
      <Link href="/" className="text-sm text-sky-400 hover:underline">
        ← メッセージに戻る
      </Link>

      {step === "menu" && (
        <div className="flex flex-1 flex-col justify-center gap-4">
          <header>
            <h1 className="text-xl font-bold text-zinc-100">予定</h1>
            <p className="mt-1 text-sm text-zinc-400">作成または一覧の確認</p>
          </header>
          {googleConnected === false && (
            <p className="rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              日程作成には「設定」で{" "}
              <Link href="/settings" className="font-medium underline">
                Google カレンダー連携
              </Link>
              が必要です（連携後、空き時間のみ選べます）。
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void startPickDates("set")}
              className="flex-1 rounded-2xl bg-zinc-800 px-4 py-4 text-base font-semibold text-zinc-100 ring-1 ring-zinc-700 transition hover:bg-zinc-700"
            >
              まとめて予約（セット）
            </button>
            <button
              type="button"
              onClick={() => void startPickDates("select")}
              className="flex-1 rounded-2xl bg-zinc-800 px-4 py-4 text-base font-semibold text-zinc-100 ring-1 ring-zinc-700 transition hover:bg-zinc-700"
            >
              ひとつずつ選択
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-bold text-zinc-100">予定確認</h1>
            <button type="button" onClick={() => setStep("menu")} className="text-sm text-sky-400">
              戻る
            </button>
          </header>
          {loadingList ? (
            <p className="text-sm text-zinc-500">読み込み中…</p>
          ) : sessions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-700 px-4 py-8 text-center text-sm text-zinc-500">
              まだ予定がありません
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/session/${s.id}`}
                    className="block rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-zinc-200 hover:border-sky-600"
                  >
                    <span className="font-medium">開始日 {s.triggerDateJst}</span>
                    <span className="mt-1 block text-xs text-zinc-500">{s.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === "pickDates" && (
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-zinc-100">
              {buildMode === "set" ? "セット予約を選ぶ" : "日付を選ぶ"}
            </h1>
            <button type="button" onClick={() => setStep("menu")} className="text-sm text-zinc-400">
              戻る
            </button>
          </header>
          <p className="text-sm text-zinc-400">
            開始日を含む<strong className="text-zinc-200">1年分</strong>
            から選べます。Google カレンダーに予定があり、
            <strong className="text-zinc-200">30分以上の連続空きが無い日</strong>
            はオレンジ色で選べません。
          </p>
          {busyPickLoading && (
            <p className="text-xs text-zinc-500">Google カレンダーの空き状況を取得しています…</p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {buildMode === "set" && (
            <section className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 ring-1 ring-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-100">固定セット</h2>
              <div className="mt-3 flex flex-col gap-2">
                {setReservationSuggestions
                  .filter((s) => !s.fromHistory && s.group !== "fixed_saturday")
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => applySetSuggestion(s)}
                      className={
                        "rounded-xl border px-3 py-2 text-left text-sm " +
                        (setSuggestionIdToYmd[s.id]
                          ? "border-amber-400 bg-amber-950/50 text-zinc-50"
                          : "border-zinc-600 bg-zinc-950 text-zinc-200")
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                <div className="rounded-xl border border-zinc-700 bg-zinc-950/60 p-2">
                  <p className="mb-2 text-xs text-zinc-500">土曜日（2つ選択可）</p>
                  <div className="flex flex-wrap gap-2">
                    {setReservationSuggestions
                      .filter((s) => s.group === "fixed_saturday")
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => applySetSuggestion(s)}
                          className={
                            "rounded-lg border px-3 py-2 text-sm " +
                            (setSuggestionIdToYmd[s.id]
                              ? "border-amber-400 bg-amber-950/50 text-zinc-50"
                              : "border-zinc-600 bg-zinc-900 text-zinc-200")
                          }
                        >
                          {s.label}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
              <h2 className="mt-4 text-sm font-semibold text-zinc-100">最近のおすすめセット</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {setReservationSuggestions
                  .filter((s) => s.fromHistory)
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => applySetSuggestion(s)}
                      className={
                        "rounded-lg border px-3 py-2 text-sm " +
                        (setSuggestionIdToYmd[s.id]
                          ? "border-amber-400 bg-amber-950/50 text-zinc-50"
                          : "border-zinc-600 bg-zinc-900 text-zinc-200")
                      }
                    >
                      {s.label}
                    </button>
                  ))}
              </div>
            </section>
          )}
          <OrganizerCalendarPicker
            eligibleYmd={eligibleSet}
            calendarBlockedYmd={calendarBlockedYmd}
            selectedYmd={selectedYmd}
            onToggleYmd={toggleYmd}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            anchor={anchor}
            onAnchorChange={setAnchor}
            suggestions={buildMode === "select" ? suggestions : []}
            onApplySuggestion={buildMode === "select" ? applySuggestion : undefined}
            highlightedSuggestionRanks={highlightedSuggestionRanks}
          />
          <button
            type="button"
            onClick={() => void goTimes()}
            className="mt-2 w-full rounded-xl bg-zinc-800 py-3.5 text-base font-semibold text-zinc-100 ring-1 ring-zinc-600 hover:bg-zinc-700"
          >
            {buildMode === "set" ? "次へ（内容確認）" : "次へ（時間を選ぶ）"}
          </button>
        </div>
      )}

      {step === "times" && buildMode === "select" && (
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-zinc-100">時間を選ぶ</h1>
            <button type="button" onClick={() => setStep("pickDates")} className="text-sm text-zinc-400">
              戻る
            </button>
          </header>
          <p className="text-sm text-zinc-400">
            Google カレンダーに入っている予定と<strong className="text-zinc-200">重なる時間帯</strong>
            は選べません。午前のみ埋まっている日は午後を、終日近くまで埋まっている場合は空いている枠だけを指定してください。
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-col gap-4">
            {concreteDates.map((ymd) => (
              <div
                key={ymd}
                className="rounded-2xl border border-zinc-700 bg-zinc-900/90 p-4 ring-1 ring-zinc-800"
              >
                <p className="mb-3 text-sm font-semibold text-zinc-200">{formatYmdChip(ymd)}</p>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-full">
                    <p className="mb-2 text-xs text-zinc-500">TIMEREMEMBER</p>
                    <div className="flex flex-wrap gap-2">
                      {timeSuggestions.map((s) => (
                        <button
                          key={`tm-${ymd}-${s.id}`}
                          type="button"
                          onClick={() => applyTimeSuggestionToDate(ymd, s)}
                          className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-teal-500"
                        >
                          第{s.rank}候補{s.rank === 1 ? `-${s.slotInRank}` : ""} {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    開始
                    <input
                      type="time"
                      value={times[ymd]?.start ?? "19:00"}
                      onChange={(e) => setRange(ymd, "start", e.target.value)}
                      className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-base text-zinc-100"
                    />
                  </label>
                  <span className="pb-2 text-zinc-500">—</span>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    終了
                    <input
                      type="time"
                      value={times[ymd]?.end ?? "20:00"}
                      onChange={(e) => setRange(ymd, "end", e.target.value)}
                      className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-base text-zinc-100"
                    />
                  </label>
                </div>
                {ymdRangeOverlapsBusy(
                  ymd,
                  times[ymd]?.start ?? "19:00",
                  times[ymd]?.end ?? "20:00",
                  calendarBusy,
                ) && (
                  <p className="mt-2 text-xs text-amber-300">
                    この時間帯は Google カレンダーの予定と重なっています。
                  </p>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={goReview}
            className="w-full rounded-xl bg-zinc-800 py-3.5 text-base font-semibold text-zinc-100 ring-1 ring-zinc-600 hover:bg-zinc-700"
          >
            次へ
          </button>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-zinc-100">内容の確認</h1>
            <button
              type="button"
              onClick={() => setStep(buildMode === "set" ? "pickDates" : "times")}
              className="text-sm text-zinc-400"
            >
              戻る
            </button>
          </header>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <ul className="flex flex-col gap-2 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4">
            {concreteDates.map((ymd) => (
              <li key={ymd} className="flex justify-between border-b border-zinc-800 py-2 text-sm last:border-0">
                <span className="text-zinc-200">{formatYmdChip(ymd)}</span>
                <span className="text-sky-300">
                  {times[ymd]?.start ?? "19:00"} – {times[ymd]?.end ?? "20:00"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            次の画面（セッション）で、参加者のメールアドレスを入力して日程候補を送ります。
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void submitWizard()}
            className="w-full rounded-xl bg-blue-600 py-4 text-base font-bold text-white shadow-lg shadow-blue-900/40 hover:bg-blue-500 disabled:opacity-50"
          >
            {pending ? "保存中…" : "候補を保存して次へ"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center py-16 text-sm text-zinc-500">
          読み込み中…
        </div>
      }
    >
      <ScheduleWizard />
    </Suspense>
  );
}
