"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  OrganizerCalendarPicker,
  type CalendarViewMode,
} from "@/components/msa/OrganizerCalendarPicker";
import { useMsaPollRefresh } from "@/hooks/useMsaPollRefresh";
import { filterYmdWithNoFreeWindow } from "@/lib/calendarFreeWindows";
import { TIMEZONE } from "@/lib/constants";
import {
  firstYmdMatchingWeekdaySkippingBlocked,
  type DayRememberSuggestion,
  type TimeRememberSuggestion,
} from "@/lib/dayRemember";
import { fetchGoogleCalendarBusyMerged } from "@/lib/fetchGoogleCalendarBusyRange";
import { ymdRangeOverlapsBusy } from "@/lib/organizerBusyCheck";

type Slot = { id: string; label: string; start: string; end: string };

type Session = {
  id: string;
  status: string;
  triggerDateJst: string;
  candidateDates?: string[];
  slots: Slot[];
  organizerRound1Ids: string[];
  participantIds: string[];
  organizerFinalIds: string[];
  participantToken: string;
  participantUserId?: string;
  participantPreferredSlotIds?: string[];
  organizerPreferredSlotIds?: string[];
  inviteEmailSentAt?: string;
  scheduleInviteSentAt?: string;
  participantDeclinedAt?: string;
  inviteEmailSent?: string;
  calendarCreated?: boolean;
  createdEventIds: string[];
  calendarMeetLinks?: string[];
};

/** PATCH /api/sessions/[id] の error コード → ユーザー向け日本語 */
const SESSION_PATCH_ERROR_JA: Record<string, string> = {
  unauthorized:
    "ログインの有効期限が切れている可能性があります。ページを再読み込みするか、ログアウトしてからログインし直してください。",
  forbidden: "この操作を行う権限がありません。",
  not_found: "セッションが見つかりません。",
  invalid_status:
    "画面の状態が古い可能性があります。ページを再読み込みしてから、もう一度確定してください。",
  legacy_session: "このセッションは古い形式のため、ここから確定できません。",
  already_completed: "すでに確定済みです。ページを再読み込みしてください。",
  invalid_json: "送信データが不正です。ページを再読み込みしてください。",
  supabase_not_configured: "サーバー設定（Supabase）が不足しています。",
  build_slots_first: "先に候補日時を作成してください。",
  slots_already_built: "候補はすでに作成済みです。ページを再読み込みしてください。",
  no_participant_selection: "参加者の候補がまだありません。",
  slot_ids_required: "候補日時を選んでください",
  invalid_slot: "選べない日時が含まれています",
  unknown_slot: "無効な候補です",
  no_overlap:
    "参加者の候補と主催者の候補に共通する枠がありません。主催者のチェックを調整してください。",
  invalid_participant_email: "有効なメールアドレスを入力してください",
  participant_is_self: "自分自身を参加者には指定できません",
  unknown_action: "不正な操作です。ページを再読み込みしてください",
  items_required: "日時の入力が必要です",
  invalid_date: "無効な日付です",
  invalid_time_format: "時間の形式が不正です",
  dates_required: "日付を選んでください",
  no_valid_slots: "有効な候補を作成できませんでした",
  participant_not_registered: "このメールはアプリ未登録です",
  invalid_participant_user: "参加者の指定が不正です",
  profile_not_found: "参加者のプロフィールが見つかりません",
  inbox_save_failed: "通知の保存に失敗しました。しばらくしてから再度お試しください。",
  session_save_failed:
    "日程の保存に失敗しました。表示される詳細メッセージを確認するか、ページを再読み込みしてください。",
};

function messageForFailedSessionPatch(
  res: Response,
  j: { error?: string; message?: string },
): string {
  if (j.message) return j.message;
  const code = j.error;
  if (code && SESSION_PATCH_ERROR_JA[code]) return SESSION_PATCH_ERROR_JA[code];
  if (code) return code;
  const byStatus: Record<number, string> = {
    401: SESSION_PATCH_ERROR_JA.unauthorized,
    403: SESSION_PATCH_ERROR_JA.forbidden,
    404: SESSION_PATCH_ERROR_JA.not_found,
    409:
      "すでに処理済みか、状態が変わっています。ページを再読み込みしてから再度お試しください。",
    500: "サーバーでエラーが発生しました。しばらくしてからもう一度お試しください。",
    502: "サーバーに一時的に接続できませんでした。通信状況を確認してください。",
    503: "サービスが一時的に利用できません。しばらくしてから再度お試しください。",
  };
  return (
    byStatus[res.status] ??
    `保存に失敗しました（HTTP ${res.status}）。ページを再読み込みしてから再度お試しください。`
  );
}

function confirmOverlapProceed(ymd: string, startHm: string, endHm: string): boolean {
  return window.confirm(
    `${ymd} ${startHm}〜${endHm} には既存の予定があります。このまま重ねて候補を作成しますか？`,
  );
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pickedDates, setPickedDates] = useState<Set<string>>(new Set());
  const [timeStart, setTimeStart] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("20:00");
  /** 確定は成功したがカレンダー未連携・API 失敗など */
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [anchor, setAnchor] = useState(() => DateTime.now().setZone(TIMEZONE).startOf("day"));
  const [suggestions, setSuggestions] = useState<DayRememberSuggestion[]>([]);
  const [timeSuggestions, setTimeSuggestions] = useState<TimeRememberSuggestion[]>([]);
  const [calendarBusy, setCalendarBusy] = useState<{ start: string; end: string }[]>([]);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [calendarBlockedYmd, setCalendarBlockedYmd] = useState<Set<string>>(new Set());
  const [busyPickLoading, setBusyPickLoading] = useState(false);
  const [pickStepBusy, setPickStepBusy] = useState<{ start: string; end: string }[]>([]);
  const [suggestionRankToYmd, setSuggestionRankToYmd] = useState<Partial<Record<1 | 2 | 3, string>>>(
    {},
  );
  /** 日付ごとの時間（複数 DAYREMEMBER で異なる時間帯を選べる） */
  const [ymdSlotTimes, setYmdSlotTimes] = useState<Record<string, { start: string; end: string }>>({});

  const highlightedSuggestionRanks = useMemo(
    () => new Set(([1, 2, 3] as const).filter((r) => Boolean(suggestionRankToYmd[r]))),
    [suggestionRankToYmd],
  );

  useEffect(() => {
    let c = true;
    params.then((p) => {
      if (c) setId(p.id);
    });
    return () => {
      c = false;
    };
  }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (res.status === 401) {
        setError("ログインが必要です");
        return;
      }
      if (res.status === 403) {
        setError("このセッションを開く権限がありません");
        return;
      }
      if (!res.ok) throw new Error("not_found");
      const data = await res.json();
      setSession(data.session);
    } catch {
      setError("読み込みに失敗しました");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const sessionFingerprint = useCallback(async () => {
    if (!id) return "";
    const res = await fetch(`/api/sessions/${id}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return `err:${res.status}`;
    const data = (await res.json().catch(() => ({}))) as { session?: Session };
    const s = data.session;
    if (!s) return "empty";
    return [
      s.status,
      s.slots?.length ?? 0,
      (s.organizerRound1Ids ?? []).join(","),
      (s.organizerFinalIds ?? []).join(","),
      (s.participantPreferredSlotIds ?? []).join(","),
      (s.organizerPreferredSlotIds ?? []).join(","),
      s.inviteEmailSentAt ?? "",
      s.scheduleInviteSentAt ?? "",
      s.participantDeclinedAt ?? "",
      String(s.calendarCreated ?? ""),
      (s.calendarMeetLinks ?? []).join(","),
      (s.createdEventIds ?? []).join(","),
    ].join("|");
  }, [id]);

  useMsaPollRefresh(sessionFingerprint, load, {
    intervalMs: 15_000,
    enabled: Boolean(id),
    resetKey: id,
  });

  useEffect(() => {
    if (!session || session.status !== "awaiting_organizer_round1" || session.slots.length > 0) {
      return;
    }
    void (async () => {
      const r = await fetch("/api/google/calendar/status", { credentials: "include", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { connected?: boolean };
      setGoogleConnected(Boolean(j.connected));
      const dates = session?.candidateDates;
      if (!dates?.length) {
        setSuggestions([]);
        setTimeSuggestions([]);
        return;
      }
      const dr = await fetch("/api/msa/day-remember", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eligibleDates: dates }),
      });
      const dj = (await dr.json().catch(() => ({}))) as {
        suggestions?: DayRememberSuggestion[];
        timeSuggestions?: TimeRememberSuggestion[];
      };
      setSuggestions(dj.suggestions ?? []);
      setTimeSuggestions(dj.timeSuggestions ?? []);
    })();
  }, [session?.id, session?.status, session?.slots?.length, session?.candidateDates]);

  const needsBuildEarly =
    session?.status === "awaiting_organizer_round1" && (session?.slots?.length ?? 0) === 0;

  useEffect(() => {
    const dates = session?.candidateDates;
    if (!needsBuildEarly || !dates?.length || googleConnected !== true) {
      setCalendarBlockedYmd(new Set());
      setPickStepBusy([]);
      return;
    }
    let cancelled = false;
    setBusyPickLoading(true);
    void (async () => {
      try {
        const sorted = [...dates].sort();
        const from = DateTime.fromISO(sorted[0], { zone: TIMEZONE }).startOf("day").toISO()!;
        const to = DateTime.fromISO(sorted[sorted.length - 1], { zone: TIMEZONE }).endOf("day").toISO()!;
        const busy = await fetchGoogleCalendarBusyMerged(from, to);
        if (cancelled) return;
        setPickStepBusy(busy);
        setCalendarBlockedYmd(filterYmdWithNoFreeWindow(dates, busy, 30));
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
  }, [needsBuildEarly, session?.candidateDates, session?.id, googleConnected]);

  useEffect(() => {
    setPickedDates((prev) => {
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

  const slotById = useMemo(() => {
    if (!session?.slots?.length) return new Map<string, Slot>();
    return new Map(session.slots.map((s) => [s.id, s]));
  }, [session]);

  function toggleDate(ymd: string) {
    setPickedDates((prev) => {
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
        setYmdSlotTimes((t) => {
          const { [ymd]: _, ...rest } = t;
          return rest;
        });
      } else {
        n.add(ymd);
        setYmdSlotTimes((t) => ({
          ...t,
          [ymd]: { start: timeStart, end: timeEnd },
        }));
      }
      return n;
    });
  }

  async function patch(body: object): Promise<boolean> {
    if (!id) return false;
    setPending(true);
    setError(null);
    setCalendarNotice(null);
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        session?: Session;
        calendarWarning?: string;
      };
      if (!res.ok) {
        throw new Error(messageForFailedSessionPatch(res, j));
      }
      if (j.session) setSession(j.session);
      if (
        j.calendarWarning === "google_calendar_not_connected" ||
        j.calendarWarning === "no_slots"
      ) {
        setCalendarNotice(
          "日程は確定しました。Google カレンダーへの追加はスキップされました（設定でカレンダーと連携すると、次回から Meet 付きで追加できます）。",
        );
      } else if (j.calendarWarning === "google_calendar_refresh_invalid") {
        setCalendarNotice(
          "日程は確定しましたが、保存されている Google 連携が無効です。設定で一度「連携を解除」してから、もう一度カレンダーと連携し直してください（本番とローカルで別アプリのときは環境ごとに連携が必要です）。",
        );
      } else if (j.calendarWarning === "google_calendar_api_error") {
        setCalendarNotice(
          "日程は確定しましたが、Google カレンダーへの追加に失敗しました。Google Cloud で Calendar API が有効か、サーバーのログを確認するか、手動で予定を作成してください。",
        );
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function sendInviteToB() {
    await patch({ action: "send_schedule_invite" });
  }

  function applyTimeSuggestionToDate(ymd: string, s: TimeRememberSuggestion) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const st = `${pad(Math.floor(s.startMin / 60))}:${pad(s.startMin % 60)}`;
    const en = `${pad(Math.floor(s.endMin / 60))}:${pad(s.endMin % 60)}`;
    setSuggestionRankToYmd((prev) => {
      const next = { ...prev };
      for (const rank of [1, 2, 3] as const) {
        if (next[rank] === ymd) delete next[rank];
      }
      return next;
    });
    setYmdSlotTimes((prev) => ({ ...prev, [ymd]: { start: st, end: en } }));
    if (pickedDates.size <= 1) {
      setTimeStart(st);
      setTimeEnd(en);
    }
  }

  function applySuggestionSession(s: DayRememberSuggestion) {
    if (suggestionRankToYmd[s.rank]) {
      const ymd = suggestionRankToYmd[s.rank]!;
      setSuggestionRankToYmd((prev) => {
        const next = { ...prev };
        delete next[s.rank];
        return next;
      });
      setPickedDates((prev) => {
        const n = new Set(prev);
        n.delete(ymd);
        return n;
      });
      setYmdSlotTimes((prev) => {
        const { [ymd]: _, ...rest } = prev;
        return rest;
      });
      setError(null);
      return;
    }
    const sorted = [...(session?.candidateDates ?? [])].sort();
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
    setPickedDates((prev) => new Set(prev).add(ymd));
    setYmdSlotTimes((prev) => ({ ...prev, [ymd]: { start: startStr, end: endStr } }));
    setTimeStart(startStr);
    setTimeEnd(endStr);
    setError(null);
  }

  async function confirmBuildSlots() {
    if (!session) return;
    if (pickedDates.size === 0) {
      setError("日付を1つ以上選んでください");
      return;
    }
    if (!googleConnected) {
      setError("設定で Google カレンダーと連携してください。");
      return;
    }
    const dates = Array.from(pickedDates).sort();
    const from = DateTime.fromISO(dates[0], { zone: TIMEZONE }).startOf("day").toISO()!;
    const to = DateTime.fromISO(dates[dates.length - 1], { zone: TIMEZONE }).endOf("day").toISO()!;
    const br = await fetch(
      `/api/google/calendar/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!br.ok) {
      setError("Google カレンダーの予定を取得できませんでした。");
      return;
    }
    const bj = (await br.json().catch(() => ({}))) as { busy?: { start: string; end: string }[] };
    const busy = bj.busy ?? [];
    setCalendarBusy(busy);
    const items = dates.map((ymd) => {
      const st = ymdSlotTimes[ymd]?.start ?? timeStart;
      const en = ymdSlotTimes[ymd]?.end ?? timeEnd;
      return { ymd, timeStart: st, timeEnd: en };
    });
    for (const it of items) {
      if (ymdRangeOverlapsBusy(it.ymd, it.timeStart, it.timeEnd, busy) && !confirmOverlapProceed(it.ymd, it.timeStart, it.timeEnd)) {
        setError("重複している予定の作成をキャンセルしました。");
        return;
      }
    }
    setError(null);
    await patch({
      action: "build_slots",
      items,
    });
  }

  const eligibleSet = useMemo(
    () => new Set(session?.candidateDates ?? []),
    [session?.candidateDates],
  );

  if (!id || !session) {
    return (
      <div className="flex flex-1 flex-col justify-center text-sm text-zinc-500">
        {error ? <p className="text-red-400">{error}</p> : "読み込み中…"}
      </div>
    );
  }

  const needsBuild = session.status === "awaiting_organizer_round1" && session.slots.length === 0;
  const candidateDates = session.candidateDates ?? [];

  const busyHintForTime = pickStepBusy.length > 0 ? pickStepBusy : calendarBusy;
  const timeOverlapWarning =
    pickedDates.size > 0 &&
    busyHintForTime.length > 0 &&
    Array.from(pickedDates).some((ymd) => {
      const st = ymdSlotTimes[ymd]?.start ?? timeStart;
      const en = ymdSlotTimes[ymd]?.end ?? timeEnd;
      return ymdRangeOverlapsBusy(ymd, st, en, busyHintForTime);
    });

  return (
    <div className="flex flex-1 flex-col gap-5 pb-4">
      <Link href="/" className="text-sm text-teal-700 hover:underline dark:text-teal-400">
        ← メッセージに戻る
      </Link>
      <header>
        <h1 className="text-lg font-bold sm:text-xl">日程調整</h1>
        <p className="text-xs text-zinc-500">開始日（トリガー）: {session.triggerDateJst}</p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {calendarNotice && (
        <p className="rounded-lg border border-zinc-600/50 bg-zinc-800/50 px-3 py-2 text-xs leading-relaxed text-zinc-200">
          {calendarNotice}{" "}
          <Link
            href="/settings?auto_calendar=1"
            className="font-medium text-teal-600 underline hover:text-teal-500 dark:text-teal-400"
          >
            設定を開いて連携する
          </Link>
        </p>
      )}

      {session.status === "participant_declined" && (
        <section className="rounded-2xl border border-rose-800/50 bg-rose-950/30 p-4 ring-1 ring-rose-900/40">
          <h2 className="text-sm font-semibold text-rose-100">Bさんが候補を見送りました</h2>
          <p className="mt-1 text-xs text-rose-200/90">
            日程が合わなかったとのことです。新しい候補を作成するには下のボタンを押してください。
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void patch({ action: "organizer_reset_after_decline" })}
            className="mt-4 w-full rounded-xl bg-rose-700 py-3 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
          >
            {pending ? "処理中…" : "候補を作り直す"}
          </button>
        </section>
      )}

      {needsBuild && (
        <div className="flex flex-col gap-4">
          {googleConnected === false && (
            <p className="rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              日程の候補を作る前に{" "}
              <Link href="/settings" className="font-medium underline">
                Google カレンダー連携
              </Link>
              を完了してください。
            </p>
          )}
          {googleConnected === null && (
            <p className="text-xs text-zinc-500">連携状態を確認しています…</p>
          )}
          <section className="rounded-2xl border border-zinc-700 bg-zinc-900/90 p-4 ring-1 ring-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">1. 日付を選ぶ（1年分・週／月）</h2>
            <p className="mt-1 text-xs text-zinc-400">
              参加できる日を複数選べます。Google カレンダーで
              <span className="text-orange-200/90">30分以上の空きが無い日</span>
              はオレンジ色で選べません。
            </p>
            {busyPickLoading && googleConnected === true && (
              <p className="mt-2 text-xs text-zinc-500">Google カレンダーの空き状況を取得しています…</p>
            )}
            {googleConnected !== false && (
              <div className="mt-3">
                <OrganizerCalendarPicker
                  eligibleYmd={eligibleSet}
                  calendarBlockedYmd={calendarBlockedYmd}
                  selectedYmd={pickedDates}
                  onToggleYmd={toggleDate}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  anchor={anchor}
                  onAnchorChange={setAnchor}
                  suggestions={suggestions}
                  onApplySuggestion={applySuggestionSession}
                  highlightedSuggestionRanks={highlightedSuggestionRanks}
                />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-700 bg-zinc-900/90 p-4 ring-1 ring-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">2. 時間帯（開始 — 終了）</h2>
            <p className="mt-1 text-xs text-zinc-400">
              日付ごとに時間を指定できます（DAYREMEMBER で複数選ぶと日ごとに別の時間帯にもできます）。Google
              カレンダーに予定がある時間は選べません。
            </p>
            <div className="mt-4 flex flex-col gap-4">
              {Array.from(pickedDates)
                .sort()
                .map((ymd) => (
                  <div
                    key={ymd}
                    className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3"
                  >
                    <span className="mb-0.5 w-full text-xs font-medium text-zinc-500 sm:w-28">{ymd}</span>
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
                        value={ymdSlotTimes[ymd]?.start ?? timeStart}
                        onChange={(e) => {
                          setSuggestionRankToYmd((prev) => {
                            const next = { ...prev };
                            for (const rank of [1, 2, 3] as const) {
                              if (next[rank] === ymd) delete next[rank];
                            }
                            return next;
                          });
                          setYmdSlotTimes((prev) => ({
                            ...prev,
                            [ymd]: {
                              start: e.target.value,
                              end: prev[ymd]?.end ?? timeEnd,
                            },
                          }));
                          if (pickedDates.size <= 1) setTimeStart(e.target.value);
                        }}
                        className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-base text-zinc-100"
                      />
                    </label>
                    <span className="pb-2 text-zinc-500">—</span>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      終了
                      <input
                        type="time"
                        value={ymdSlotTimes[ymd]?.end ?? timeEnd}
                        onChange={(e) => {
                          setSuggestionRankToYmd((prev) => {
                            const next = { ...prev };
                            for (const rank of [1, 2, 3] as const) {
                              if (next[rank] === ymd) delete next[rank];
                            }
                            return next;
                          });
                          setYmdSlotTimes((prev) => ({
                            ...prev,
                            [ymd]: {
                              start: prev[ymd]?.start ?? timeStart,
                              end: e.target.value,
                            },
                          }));
                          if (pickedDates.size <= 1) setTimeEnd(e.target.value);
                        }}
                        className="rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-base text-zinc-100"
                      />
                    </label>
                  </div>
                ))}
            </div>
            {timeOverlapWarning && (
                <p className="mt-2 text-xs text-amber-300">
                  選択中の時間帯が Google カレンダーの予定と重なっています。作成時に確認ダイアログが表示されます。
                </p>
              )}
            <button
              type="button"
              disabled={pending || pickedDates.size === 0 || googleConnected === false}
              onClick={() => void confirmBuildSlots()}
              className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              候補を作成
            </button>
          </section>
        </div>
      )}

      {session.status === "awaiting_organizer_round1" && session.slots.length > 0 && (
        <section className="rounded-2xl border border-zinc-700 bg-zinc-900/90 p-4 ring-1 ring-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">参加者（Bさん）に日程候補を送る</h2>
          <p className="mt-1 text-xs text-zinc-400">
            候補の日時を作成したら、下のボタンで B さんにアプリ内通知・プッシュ・LINE で案内します（メールは送りません）。
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void sendInviteToB()}
            className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "送信中…" : "Bさんに案内を送る"}
          </button>
        </section>
      )}

      {session.status === "awaiting_participant_availability" && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">Bさんの確定待ち</h2>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
            B さんに案内を送りました。B さんが候補を選んで確定すると、あなたの Google
            カレンダーに予定が入り、こちらに通知だけ届きます。
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-3 w-full rounded-xl border border-amber-300 py-2 text-sm font-medium text-amber-800 dark:border-amber-700 dark:text-amber-200"
          >
            状態を更新
          </button>
        </section>
      )}

      {session.status === "awaiting_organizer_confirm" && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">旧フロー</h2>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
            このセッションは以前の「主催者が最終確定」形式のままです。新規調整では B
            の確定だけで完了します。
          </p>
        </section>
      )}

      {(session.status === "awaiting_participant" || session.status === "awaiting_organizer_final") && (
        <section className="rounded-2xl border border-zinc-600 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          このセッションは以前のフロー（リンク共有型）です。
        </section>
      )}

      {session.status === "completed" && (
        <section className="rounded-2xl border border-zinc-700 bg-zinc-900/90 p-4 ring-1 ring-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">確定済み</h2>
          <p className="mt-1 text-xs text-zinc-300">参加者: Bさん</p>
          {session.calendarCreated ? (
            <>
              <p className="mt-2 text-xs text-zinc-300">
                主催者の Google カレンダーに予定を追加しました。
              </p>
              {(session.calendarMeetLinks ?? []).filter(Boolean).length > 0 && (
                <ul className="mt-3 space-y-2 text-xs">
                  {(session.calendarMeetLinks ?? [])
                    .filter(Boolean)
                    .map((link, i) => (
                      <li key={`${link}-${i}`}>
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-teal-400 underline hover:text-teal-300"
                        >
                          {link}
                        </a>
                      </li>
                    ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-zinc-400">
              Google カレンダーには自動追加されていません。{" "}
              <Link
                href="/settings?auto_calendar=1"
                className="font-medium text-teal-400 underline hover:text-teal-300"
              >
                設定を開く
              </Link>
              と、画面の案内に従って Google の許可へ進めます（次回の確定から Meet 付きで追加できます）。
            </p>
          )}
          {session.createdEventIds.length > 0 && (
            <p className="mt-3 text-[11px] text-zinc-500">
              カレンダーイベント ID: {session.createdEventIds.join(", ")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
