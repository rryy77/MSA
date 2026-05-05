"use client";

import { DateTime } from "luxon";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TIMEZONE } from "@/lib/constants";
import { busyMinutesOnDayJst, filterYmdWithNoFreeWindow } from "@/lib/calendarFreeWindows";
import { type SetModeRecommendation } from "@/lib/dayRemember";
import { getSelectableDatesJstYear } from "@/lib/dateRange";
import { fetchGoogleCalendarBusyMerged } from "@/lib/fetchGoogleCalendarBusyRange";
import { ymdRangeOverlapsBusy } from "@/lib/organizerBusyCheck";

const WD_LABEL = ["", "月", "火", "水", "木", "金", "土", "日"];

function formatYmdChip(ymd: string): string {
  const d = DateTime.fromISO(ymd, { zone: TIMEZONE });
  if (!d.isValid) return ymd;
  return `${d.month}/${d.day}（${WD_LABEL[d.weekday]}）`;
}

function hmFromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function durationLabelFromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}時間`;
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

function confirmOverlapProceed(ymd: string, startHm: string, endHm: string): boolean {
  return window.confirm(
    `${formatYmdChip(ymd)} ${startHm}〜${endHm} には既存の予定があります。このまま重ねて作成しますか？`,
  );
}

type Step = "pickDates" | "review";

function ScheduleWizard() {
  const [step, setStep] = useState<Step>("pickDates");
  const [eligibleDates, setEligibleDates] = useState<string[]>([]);
  const eligibleSet = useMemo(() => new Set(eligibleDates), [eligibleDates]);
  const [selectedYmd, setSelectedYmd] = useState<Set<string>>(new Set());
  const [concreteDates, setConcreteDates] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, { start: string; end: string }>>({});
  const [anchor, setAnchor] = useState(() => DateTime.now().setZone(TIMEZONE).startOf("day"));
  const [setModeRecommend, setSetModeRecommend] = useState<SetModeRecommendation>({
    startMinSuggestions: [20 * 60, 19 * 60, 18 * 60],
    durationHourSuggestions: [2, 1, 3],
  });
  const [setStartMin, setSetStartMin] = useState(20 * 60);
  const [setDurationMin, setSetDurationMin] = useState(120);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  /** 30分以上の空きが無い日（Google 予定で埋まっている） */
  const [calendarBlockedYmd, setCalendarBlockedYmd] = useState<Set<string>>(new Set());
  const [busyPickLoading, setBusyPickLoading] = useState(false);
  const [pickStepBusy, setPickStepBusy] = useState<{ start: string; end: string }[]>([]);

  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actorRole, setActorRole] = useState<"organizer" | "participant" | null>(null);
  const [organizerUi, setOrganizerUi] = useState<"loading" | "ready" | "no_google">("loading");
  const organizerBootstrapRan = useRef(false);

  useEffect(() => {
    fetch("/api/msa/session", { credentials: "include" })
      .then((r) => r.json())
      .then((j: { role?: string }) => {
        setActorRole(j.role === "organizer" ? "organizer" : j.role === "participant" ? "participant" : null);
      })
      .catch(() => setActorRole(null));
  }, []);

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

  useEffect(() => {
    if (actorRole !== "organizer") return;
    if (organizerBootstrapRan.current) return;
    organizerBootstrapRan.current = true;
    let cancelled = false;
    void (async () => {
      setOrganizerUi("loading");
      setError(null);
      await refreshGoogleStatus();
      const r = await fetch("/api/google/calendar/status", { credentials: "include", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { connected?: boolean };
      if (cancelled) return;
      if (!j.connected) {
        setGoogleConnected(false);
        setError(
          "日程作成の前に、設定で Google カレンダーと連携してください（予定のある時間帯を避けるため）。",
        );
        setOrganizerUi("no_google");
        return;
      }
      setGoogleConnected(true);
      setSelectedYmd(new Set());
      setTimes({});
      setStep("pickDates");
      setOrganizerUi("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [actorRole, refreshGoogleStatus]);

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
        setMode?: SetModeRecommendation;
      };
      if (j.setMode) {
        setSetModeRecommend(j.setMode);
        if (j.setMode.startMinSuggestions.length > 0) setSetStartMin(j.setMode.startMinSuggestions[0]);
        if (j.setMode.durationHourSuggestions.length > 0) {
          const d = j.setMode.durationHourSuggestions[0];
          setSetDurationMin((d >= 1 && d <= 3 ? d : 2) * 60);
        }
      }
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
  }, [calendarBlockedYmd]);

  function toggleYmd(ymd: string) {
    setSelectedYmd((prev) => {
      const n = new Set(prev);
      if (n.has(ymd)) {
        n.delete(ymd);
        setTimes((t) => {
          const { [ymd]: _, ...rest } = t;
          return rest;
        });
      } else {
        n.add(ymd);
      }
      return n;
    });
  }

  function proceedToReview() {
    if (selectedYmd.size === 0) {
      setError("日付を1つ以上選んでください");
      return;
    }
    setError(null);
    const dates = Array.from(selectedYmd).sort();
    const st = hmFromMin(setStartMin);
    const en = hmFromMin(setStartMin + setDurationMin);
    setConcreteDates(dates);
    setTimes((prev) => {
      const next = { ...prev };
      for (const ymd of dates) {
        next[ymd] = { start: st, end: en };
      }
      return next;
    });
    setStep("review");
  }

  function firstBusyOverlap(): { ymd: string; start: string; end: string } | null {
    for (const ymd of concreteDates) {
      const st = times[ymd]?.start ?? "19:00";
      const en = times[ymd]?.end ?? "20:00";
      if (ymdRangeOverlapsBusy(ymd, st, en, pickStepBusy)) {
        return { ymd, start: st, end: en };
      }
    }
    return null;
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

  const setMonthGrid = useMemo(() => {
    const a = anchor.setZone(TIMEZONE).startOf("month");
    const firstDow = a.weekday;
    const pad = firstDow === 7 ? 6 : firstDow - 1;
    const start = a.minus({ days: pad });
    const cells: DateTime[] = [];
    for (let i = 0; i < 42; i++) cells.push(start.plus({ days: i }));
    return { monthLabel: a.toFormat("y年M月"), cells };
  }, [anchor]);
  const setStartHm = hmFromMin(setStartMin);
  const setEndHm = hmFromMin(setStartMin + setDurationMin);
  const maxStartMin = 24 * 60 - setDurationMin;
  const allStartOptions = useMemo(() => {
    const out: number[] = [];
    for (let h = 7; h <= 22; h++) out.push(h * 60);
    return out;
  }, []);
  useEffect(() => {
    if (setStartMin > maxStartMin) setSetStartMin(maxStartMin);
  }, [maxStartMin, setStartMin]);

  if (actorRole === null) {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-6">
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← メッセージに戻る
        </Link>
        <p className="text-sm text-zinc-500">読み込み中…</p>
      </div>
    );
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

  if (organizerUi === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-6">
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← メッセージに戻る
        </Link>
        <p className="text-sm text-zinc-500">Google カレンダー連携を確認しています…</p>
      </div>
    );
  }

  if (organizerUi === "no_google") {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-6">
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← メッセージに戻る
        </Link>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          日程作成には「設定」で{" "}
          <Link href="/settings" className="font-medium underline">
            Google カレンダー連携
          </Link>
          が必要です。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <Link href="/" className="text-sm text-sky-400 hover:underline">
        ← メッセージに戻る
      </Link>

      {step === "pickDates" && (
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-zinc-100">予定作成</h1>
          </header>
          <p className="text-sm text-zinc-400">
            開始時間・長さを決めて、カレンダーで日付を複数選んでください。
          </p>
          {busyPickLoading && (
            <p className="text-xs text-zinc-500">Google カレンダーの空き状況を取得しています…</p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <section className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 ring-1 ring-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">1) 開始時間を選ぶ</h2>
            <p className="mt-1 text-xs text-zinc-500">
              おすすめは、直近で確定した予定の開始時間から自動で表示しています。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {setModeRecommend.startMinSuggestions.map((m, i) => (
                <button
                  key={`rec-start-${m}`}
                  type="button"
                  onClick={() => setSetStartMin(m)}
                  className={
                    "rounded-lg border px-3 py-2 text-sm " +
                    (setStartMin === m
                      ? "border-teal-400 bg-teal-950/50 text-teal-100"
                      : "border-zinc-600 bg-zinc-900 text-zinc-200")
                  }
                >
                  おすすめ{i + 1}（直近） {hmFromMin(m)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {allStartOptions.filter((m) => m <= maxStartMin).map((m) => (
                <button
                  key={`all-start-${m}`}
                  type="button"
                  onClick={() => setSetStartMin(m)}
                  className={
                    "rounded-lg border px-3 py-2 text-sm " +
                    (setStartMin === m
                      ? "border-amber-400 bg-amber-950/50 text-zinc-50"
                      : "border-zinc-700 bg-zinc-950 text-zinc-300")
                  }
                >
                  {hmFromMin(m)}
                </button>
              ))}
            </div>

            <h2 className="mt-4 text-sm font-semibold text-zinc-100">2) 長さを選ぶ</h2>
            <p className="mt-1 text-xs text-zinc-500">
              1〜3時間は基本候補です。「おすすめ」は直近の利用傾向を反映しています。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 3].map((h) => (
                <button
                  key={`dur-${h}`}
                  type="button"
                  onClick={() => setSetDurationMin(h * 60)}
                  className={
                    "rounded-lg border px-4 py-2 text-sm " +
                    (setDurationMin === h * 60
                      ? "border-amber-400 bg-amber-950/50 text-zinc-50"
                      : "border-zinc-700 bg-zinc-950 text-zinc-300")
                  }
                >
                  {h}時間
                  {setModeRecommend.durationHourSuggestions.includes(h) ? "（おすすめ・直近）" : ""}
                </button>
              ))}
            </div>
            <details className="mt-2 rounded-lg border border-zinc-700 bg-zinc-950/60 p-3">
              <summary className="cursor-pointer text-xs text-zinc-400">詳細な長さを選ぶ（30分刻み）</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {[30, 60, 90, 120, 150, 180, 210, 240, 300, 360].map((m) => (
                  <button
                    key={`dur-min-${m}`}
                    type="button"
                    onClick={() => setSetDurationMin(m)}
                    className={
                      "rounded-lg border px-3 py-2 text-xs " +
                      (setDurationMin === m
                        ? "border-teal-400 bg-teal-950/40 text-teal-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300")
                    }
                  >
                    {durationLabelFromMin(m)}
                  </button>
                ))}
              </div>
            </details>

            <h2 className="mt-4 text-sm font-semibold text-zinc-100">3) カレンダーで日付を選ぶ</h2>
            <p className="mt-1 text-xs text-zinc-500">
              条件: {setStartHm}〜{setEndHm}（{durationLabelFromMin(setDurationMin)} / 複数日選択可）
            </p>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setAnchor(anchor.minus({ months: 1 }))}
                className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300"
              >
                ‹
              </button>
              <span className="text-sm text-zinc-200">{setMonthGrid.monthLabel}</span>
              <button
                type="button"
                onClick={() => setAnchor(anchor.plus({ months: 1 }))}
                className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300"
              >
                ›
              </button>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1 text-[10px] text-zinc-500">
              {["月", "火", "水", "木", "金", "土", "日"].map((w) => (
                <div key={`h-${w}`} className="py-1 text-center">
                  {w}
                </div>
              ))}
              {setMonthGrid.cells.map((d) => {
                const ymd = d.toISODate()!;
                const inMonth = d.month === anchor.month;
                const inEligible = eligibleSet.has(ymd);
                const blocked = calendarBlockedYmd.has(ymd);
                const overlap = ymdRangeOverlapsBusy(ymd, setStartHm, setEndHm, pickStepBusy);
                const busyMin = busyMinutesOnDayJst(ymd, pickStepBusy);
                const symbol = !inMonth || !inEligible || blocked ? "×" : overlap ? "△" : busyMin === 0 ? "◎" : "○";
                const canTap = inMonth && inEligible && !blocked;
                const selected = selectedYmd.has(ymd);
                return (
                  <button
                    key={`set-${ymd}`}
                    type="button"
                    disabled={!canTap}
                    onClick={() => canTap && toggleYmd(ymd)}
                    className={
                      "relative flex h-12 items-center justify-center rounded-lg border text-sm " +
                      (!inMonth
                        ? "border-transparent text-zinc-700 opacity-40"
                        : !inEligible || blocked
                          ? "border-zinc-800 bg-zinc-950/40 text-zinc-600"
                          : selected
                            ? "border-teal-400 bg-teal-950/40 text-zinc-50"
                            : "border-zinc-700 bg-zinc-900 text-zinc-200")
                    }
                  >
                    <span>{d.day}</span>
                    <span className="absolute right-1 top-1 text-[10px]">{symbol}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">◎ 空き十分 / ○ 選択可能 / △ 一部重なり（確認あり） / × 選択不可</p>
          </section>
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-20 mt-2">
            <button
              type="button"
              onClick={() => void proceedToReview()}
              className="w-full rounded-xl bg-zinc-100 py-4 text-lg font-bold text-zinc-900 shadow-xl shadow-zinc-950/30 ring-1 ring-zinc-200 active:scale-[0.99]"
            >
              次へ（内容確認）
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-zinc-100">内容の確認</h1>
            <button type="button" onClick={() => setStep("pickDates")} className="text-sm text-zinc-400">
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
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-20">
            <button
              type="button"
              disabled={pending}
              onClick={() => void submitWizard()}
              className="w-full rounded-xl bg-blue-600 py-4 text-lg font-bold text-white shadow-lg shadow-blue-900/40 hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50"
            >
              {pending ? "保存中…" : "候補を保存して次へ"}
            </button>
          </div>
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
