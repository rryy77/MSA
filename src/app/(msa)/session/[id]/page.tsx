"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  getDefaultInviteEmail,
  getInviteEmailHistory,
  rememberInviteEmail,
} from "@/lib/inviteEmailHistory";

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
  participantEmail?: string;
  participantUserId?: string;
  participantPreferredSlotIds?: string[];
  organizerPreferredSlotIds?: string[];
  inviteEmailSentAt?: string;
  scheduleInviteSentAt?: string;
  inviteEmailSent?: string;
  calendarCreated?: boolean;
  createdEventIds: string[];
  calendarMeetLinks?: string[];
};

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pickedDates, setPickedDates] = useState<Set<string>>(new Set());
  const [timeStart, setTimeStart] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("20:00");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailSuggestions, setInviteEmailSuggestions] = useState<string[]>([]);
  /** 外部メール未送信時の注意（アプリ内通知は成功している場合あり） */
  const [mailNotice, setMailNotice] = useState<string | null>(null);
  /** 確定は成功したがカレンダー未連携・API 失敗など */
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  /** 主催者が「都合が付く」とチェックした枠（確定時に参加者候補との積集合になる） */
  const [organizerSelected, setOrganizerSelected] = useState<Set<string>>(new Set());
  const organizerInitRef = useRef<string | null>(null);

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
      const res = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
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

  useEffect(() => {
    setInviteEmail(getDefaultInviteEmail());
    setInviteEmailSuggestions(getInviteEmailHistory());
  }, []);

  const slotById = useMemo(() => {
    if (!session?.slots?.length) return new Map<string, Slot>();
    return new Map(session.slots.map((s) => [s.id, s]));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (session.status !== "awaiting_organizer_confirm") {
      organizerInitRef.current = null;
      return;
    }
    const key = session.id;
    if (organizerInitRef.current === key) return;
    organizerInitRef.current = key;
    setOrganizerSelected(new Set(session.participantPreferredSlotIds ?? []));
  }, [session]);

  function toggleDate(ymd: string) {
    setPickedDates((prev) => {
      const n = new Set(prev);
      if (n.has(ymd)) n.delete(ymd);
      else n.add(ymd);
      return n;
    });
  }

  async function patch(body: object): Promise<boolean> {
    if (!id) return false;
    setPending(true);
    setError(null);
    setMailNotice(null);
    setCalendarNotice(null);
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        session?: Session;
        inviteEmailSent?: boolean;
        calendarWarning?: string;
      };
      if (!res.ok) {
        const code = j.error;
        const byCode: Record<string, string> = {
          invalid_participant_email: "有効なメールアドレスを入力してください",
          participant_is_self: "自分自身を参加者には指定できません",
          unknown_action: "不正な操作です。ページを再読み込みしてください",
          no_participant_selection: "参加者の候補がまだありません",
          slot_ids_required: "候補日時を選んでください",
          invalid_slot: "選べない日時が含まれています",
          unknown_slot: "無効な候補です",
          invalid_json: "送信データが不正です",
          no_overlap:
            "参加者の候補と主催者の候補に共通する枠がありません。主催者のチェックを調整してください。",
        };
        throw new Error(
          j.message || (code && byCode[code]) || code || "保存に失敗しました",
        );
      }
      if (j.session) setSession(j.session);
      const action = (body as { action?: string }).action;
      if (action === "send_schedule_invite" && j.inviteEmailSent === false) {
        setMailNotice(
          "外部メールは届いていません（送信未設定・エラー・または宛先制限の可能性）。アプリ内通知は届いていることがあります。Resend/SMTP と迷惑メールを確認してください。",
        );
      }
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

  async function sendInvite() {
    const em = inviteEmail.trim().toLowerCase();
    if (!em) {
      setError("参加者のメールアドレスを入力してください");
      return;
    }
    const ok = await patch({ action: "send_schedule_invite", participantEmail: em });
    if (ok) {
      rememberInviteEmail(em);
      setInviteEmail(getDefaultInviteEmail());
      setInviteEmailSuggestions(getInviteEmailHistory());
    }
  }

  async function confirmFinal() {
    if (!session) return;
    const slotIds = Array.from(organizerSelected);
    if (slotIds.length === 0) {
      setError("主催者の都合が付く枠を1つ以上選んでください");
      return;
    }
    const pSet = new Set(session.participantPreferredSlotIds ?? []);
    const overlap = slotIds.filter((id) => pSet.has(id));
    if (overlap.length === 0) {
      setError(
        "参加者の候補と共通する枠がありません。主催者のチェックを増やすか、参加者の候補を確認してください。",
      );
      return;
    }
    await patch({ action: "organizer_confirm_final", slotIds });
  }

  function toggleOrganizerSlot(sid: string) {
    setOrganizerSelected((prev) => {
      const n = new Set(prev);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      return n;
    });
  }

  if (!id || !session) {
    return (
      <div className="flex flex-1 flex-col justify-center text-sm text-zinc-500">
        {error ? <p className="text-red-400">{error}</p> : "読み込み中…"}
      </div>
    );
  }

  const needsBuild = session.status === "awaiting_organizer_round1" && session.slots.length === 0;
  const candidateDates = session.candidateDates ?? [];

  const roundSlots = (session.organizerRound1Ids ?? [])
    .map((sid) => slotById.get(sid))
    .filter(Boolean) as Slot[];
  roundSlots.sort((a, b) => a.start.localeCompare(b.start));

  const participantPickSet = new Set(session.participantPreferredSlotIds ?? []);
  const overlapCount = [...organizerSelected].filter((id) => participantPickSet.has(id)).length;

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
      {mailNotice && (
        <p className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-100/95">
          {mailNotice}
        </p>
      )}
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

      {needsBuild && (
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">1. 日付を選ぶ</h2>
            <p className="mt-1 text-xs text-zinc-500">参加できる日を複数選べます。</p>
            <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {candidateDates.map((ymd) => (
                <li key={ymd}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                    <input
                      type="checkbox"
                      checked={pickedDates.has(ymd)}
                      onChange={() => toggleDate(ymd)}
                    />
                    <span className="text-sm">{ymd}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">2. 時間帯（開始 — 終了）</h2>
            <p className="mt-1 text-xs text-zinc-500">選んだ日に同じ時間帯を適用します（JST）。</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                開始
                <input
                  type="time"
                  value={timeStart}
                  onChange={(e) => setTimeStart(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
              <span className="pt-5 text-zinc-400">—</span>
              <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                終了
                <input
                  type="time"
                  value={timeEnd}
                  onChange={(e) => setTimeEnd(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending || pickedDates.size === 0}
              onClick={() =>
                patch({
                  action: "build_slots",
                  dates: Array.from(pickedDates).sort(),
                  timeStart,
                  timeEnd,
                })
              }
              className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              候補を作成
            </button>
          </section>
        </div>
      )}

      {session.status === "awaiting_organizer_round1" && session.slots.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">参加者に日程候補を送る</h2>
          <p className="mt-1 text-xs text-zinc-500">
            アプリに登録している相手のメールアドレスを入力してください。メッセージに通知が届き、相手は行ける枠にチェックを付けて返信します。
          </p>
          <label className="mt-3 flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">参加者のメール</span>
            <input
              type="email"
              autoComplete="email"
              list="msa-invite-email-history"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="example@gmail.com"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <datalist id="msa-invite-email-history">
              {inviteEmailSuggestions.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </label>
          <button
            type="button"
            disabled={pending || !inviteEmail.trim()}
            onClick={() => void sendInvite()}
            className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "送信中…" : "送信"}
          </button>
        </section>
      )}

      {session.status === "awaiting_participant_availability" && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">相手の回答待ち</h2>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
            {session.participantEmail
              ? `「${session.participantEmail}」宛に案内を送りました。相手がチェックして返信するまでお待ちください。`
              : "案内を送信済みです。相手の返信をお待ちください。"}
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
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">最終調整（参加者・主催者）</h2>
          <p className="mt-1 text-xs text-zinc-500">
            参加者が選んだ枠と、主催者の都合が両方つく枠だけが確定します。主催者の列にチェックを入れて調整してください。
          </p>
          {roundSlots.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">候補がありません。</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setOrganizerSelected(new Set(session.organizerRound1Ids ?? []))
                  }
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                >
                  全選択
                </button>
                <button
                  type="button"
                  onClick={() => setOrganizerSelected(new Set())}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                >
                  全解除
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOrganizerSelected(
                      new Set(session.participantPreferredSlotIds ?? []),
                    )
                  }
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                >
                  参加者の候補のみ選択
                </button>
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                <table className="w-full min-w-[320px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/80">
                      <th className="px-3 py-2 font-semibold text-zinc-700 dark:text-zinc-200">
                        候補
                      </th>
                      <th className="w-24 px-2 py-2 text-center font-semibold text-zinc-700 dark:text-zinc-200">
                        参加者
                      </th>
                      <th className="w-28 px-2 py-2 text-center font-semibold text-zinc-700 dark:text-zinc-200">
                        主催者
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {roundSlots.map((s) => {
                      const pOk = participantPickSet.has(s.id);
                      const oOk = organizerSelected.has(s.id);
                      return (
                        <tr
                          key={s.id}
                          className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                        >
                          <td className="px-3 py-2.5 text-zinc-800 dark:text-zinc-200">
                            {s.label}
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            {pOk ? (
                              <span className="text-teal-600 dark:text-teal-400" title="都合が付く">
                                ✓
                              </span>
                            ) : (
                              <span className="text-zinc-300 dark:text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={oOk}
                              onChange={() => toggleOrganizerSlot(s.id)}
                              className="h-4 w-4 accent-teal-600"
                              aria-label={`主催者の都合: ${s.label}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                確定に含まれる枠（両方チェック）:{" "}
                <span className="font-semibold text-teal-700 dark:text-teal-400">
                  {overlapCount}
                </span>{" "}
                件
              </p>
            </>
          )}
          <button
            type="button"
            disabled={pending || roundSlots.length === 0 || overlapCount === 0}
            onClick={() => void confirmFinal()}
            className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "処理中…" : "確定する"}
          </button>
        </section>
      )}

      {(session.status === "awaiting_participant" || session.status === "awaiting_organizer_final") && (
        <section className="rounded-2xl border border-zinc-600 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          このセッションは以前のフロー（リンク共有型）です。新規作成ではメール送信フローをご利用ください。
        </section>
      )}

      {session.status === "completed" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">確定済み</h2>
          {session.participantEmail && (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">参加者: {session.participantEmail}</p>
          )}
          {session.calendarCreated ? (
            <>
              <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
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
                          className="break-all text-teal-700 underline hover:text-teal-600 dark:text-teal-400"
                        >
                          {link}
                        </a>
                      </li>
                    ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              Google カレンダーには自動追加されていません。{" "}
              <Link
                href="/settings?auto_calendar=1"
                className="font-medium text-teal-700 underline hover:text-teal-600 dark:text-teal-400"
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
