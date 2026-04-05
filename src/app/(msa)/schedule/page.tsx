"use client";

import { DateTime } from "luxon";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TIMEZONE } from "@/lib/constants";
import { getSelectableDatesJst } from "@/lib/dateRange";

const WD_LABEL = ["", "月", "火", "水", "木", "金", "土", "日"];

function formatYmdChip(ymd: string): string {
  const d = DateTime.fromISO(ymd, { zone: TIMEZONE });
  if (!d.isValid) return ymd;
  return `${d.month}/${d.day}（${WD_LABEL[d.weekday]}）`;
}

type Step = "menu" | "pickDates" | "times" | "review" | "confirm";

type Summary = { id: string; status: string; triggerDateJst: string; triggerAt: string };

function ScheduleWizard() {
  const [step, setStep] = useState<Step>("menu");
  const [eligibleDates, setEligibleDates] = useState<string[]>([]);
  const [selectedYmd, setSelectedYmd] = useState<Set<string>>(new Set());
  const [concreteDates, setConcreteDates] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, { start: string; end: string }>>({});
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Summary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("view") === "confirm") {
      setStep("confirm");
    }
  }, [searchParams]);

  useEffect(() => {
    setEligibleDates(getSelectableDatesJst(new Date()));
  }, []);

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

  function toggleYmd(ymd: string) {
    setSelectedYmd((prev) => {
      const n = new Set(prev);
      if (n.has(ymd)) n.delete(ymd);
      else n.add(ymd);
      return n;
    });
  }

  function goTimes() {
    if (selectedYmd.size === 0) {
      setError("日付を1つ以上選んでください");
      return;
    }
    setError(null);
    const dates = Array.from(selectedYmd).sort();
    setConcreteDates(dates);
    setTimes((prev) => {
      const next = { ...prev };
      for (const ymd of dates) {
        if (!next[ymd]) next[ymd] = { start: "19:00", end: "20:00" };
      }
      return next;
    });
    setStep("times");
  }

  function setRange(ymd: string, field: "start" | "end", value: string) {
    setTimes((prev) => ({
      ...prev,
      [ymd]: { ...prev[ymd], [field]: value },
    }));
  }

  async function submitWizard() {
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
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSelectedYmd(new Set());
                setStep("pickDates");
              }}
              className="flex-1 rounded-2xl bg-zinc-800 px-4 py-4 text-base font-semibold text-zinc-100 ring-1 ring-zinc-700 transition hover:bg-zinc-700"
            >
              予定作成
            </button>
            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="flex-1 rounded-2xl bg-zinc-800 px-4 py-4 text-base font-semibold text-zinc-100 ring-1 ring-zinc-700 transition hover:bg-zinc-700"
            >
              予定確認
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
            <h1 className="text-lg font-bold text-zinc-100">日付を選ぶ</h1>
            <button type="button" onClick={() => setStep("menu")} className="text-sm text-zinc-400">
              戻る
            </button>
          </header>
          <p className="text-sm text-zinc-400">
            時間はまだ選びません。候補日のうち参加できる日を選んでください。例: 4月4日に予定を作成した場合、候補は4月4日〜4月12日まで（9日間）です。
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {eligibleDates.map((ymd) => {
              const sel = selectedYmd.has(ymd);
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => toggleYmd(ymd)}
                  className={
                    "rounded-xl border px-3 py-2.5 text-sm font-semibold transition " +
                    (sel
                      ? "border-sky-500 bg-sky-600/30 text-sky-100"
                      : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:border-zinc-500")
                  }
                >
                  {formatYmdChip(ymd)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={goTimes}
            className="mt-2 w-full rounded-xl bg-zinc-800 py-3.5 text-base font-semibold text-zinc-100 ring-1 ring-zinc-600 hover:bg-zinc-700"
          >
            次へ
          </button>
        </div>
      )}

      {step === "times" && (
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-zinc-100">時間を選ぶ</h1>
            <button type="button" onClick={() => setStep("pickDates")} className="text-sm text-zinc-400">
              戻る
            </button>
          </header>
          <p className="text-sm text-zinc-400">日付ごとに開始・終了時刻を指定してください。</p>
          <div className="flex flex-col gap-4">
            {concreteDates.map((ymd) => (
              <div
                key={ymd}
                className="rounded-2xl border border-zinc-700 bg-zinc-900/90 p-4 ring-1 ring-zinc-800"
              >
                <p className="mb-3 text-sm font-semibold text-zinc-200">{formatYmdChip(ymd)}</p>
                <div className="flex flex-wrap items-end gap-4">
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
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep("review");
            }}
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
            <button type="button" onClick={() => setStep("times")} className="text-sm text-zinc-400">
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
            onClick={submitWizard}
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
