"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TIMEZONE } from "@/lib/constants";

type Slot = { id: string; label: string; start: string; end: string };

type Session = {
  id: string;
  status: string;
  slots: Slot[];
  organizerRound1Ids: string[];
  participantIds: string[];
  participantToken: string;
};

function hmFromIsoInJst(iso: string): string {
  const d = DateTime.fromISO(iso, { zone: TIMEZONE });
  if (!d.isValid) return "09:00";
  return `${String(d.hour).padStart(2, "0")}:${String(d.minute).padStart(2, "0")}`;
}

function dateLabelFromSlot(slot: { start: string }): string {
  const d = DateTime.fromISO(slot.start, { zone: TIMEZONE });
  if (!d.isValid) return "";
  const wd = ["月", "火", "水", "木", "金", "土", "日"][d.weekday - 1];
  return `${d.year}年${d.month}月${d.day}日（${wd}）`;
}

export default function ParticipantPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [slotTimes, setSlotTimes] = useState<Record<string, { start: string; end: string }>>({});

  useEffect(() => {
    let c = true;
    params.then((p) => {
      if (c) setToken(p.token);
    });
    return () => {
      c = false;
    };
  }, [params]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await fetch(`/api/participant/${encodeURIComponent(token)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("not_found");
      const data = await res.json();
      setSession(data.session);
    } catch {
      setError("無効なリンクです");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!session?.slots?.length) return;
    const next: Record<string, { start: string; end: string }> = {};
    for (const s of session.slots) {
      next[s.id] = {
        start: hmFromIsoInJst(s.start),
        end: hmFromIsoInJst(s.end),
      };
    }
    setSlotTimes(next);
  }, [session?.id, session?.slots]);

  function toggle(sid: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      return n;
    });
  }

  const slotById = useMemo(() => {
    if (!session) return new Map<string, Slot>();
    return new Map(session.slots.map((s) => [s.id, s]));
  }, [session]);

  const choices = useMemo(() => {
    if (!session) return [];
    return session.organizerRound1Ids.map((id) => slotById.get(id)).filter(Boolean) as Slot[];
  }, [session, slotById]);

  const canAnswerOld = session?.status === "awaiting_participant";
  const canAnswerNew = session?.status === "awaiting_participant_availability";

  async function rejectSchedule() {
    if (!session || !token || !canAnswerNew) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "participant_reject_schedule_token",
          token,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setSession(data.session);
    } catch {
      setError("送信に失敗しました");
    } finally {
      setPending(false);
    }
  }

  async function submit() {
    if (!session || !token) return;
    if (!canAnswerOld && !canAnswerNew) return;
    setPending(true);
    setError(null);
    try {
      const body =
        canAnswerNew
          ? {
              action: "participant_submit_availability_token" as const,
              token,
              slotIds: Array.from(selected),
              slotTimeAdjustments: Array.from(selected).map((id) => {
                const slot = slotById.get(id);
                if (!slot) throw new Error("slot");
                const t = slotTimes[id];
                return {
                  slotId: id,
                  timeStart: t?.start ?? hmFromIsoInJst(slot.start),
                  timeEnd: t?.end ?? hmFromIsoInJst(slot.end),
                };
              }),
            }
          : {
              action: "participant" as const,
              token,
              slotIds: Array.from(selected),
            };
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setSession(data.session);
    } catch {
      setError("送信に失敗しました");
    } finally {
      setPending(false);
    }
  }

  if (!token) return <p className="text-sm text-zinc-500">読み込み中…</p>;
  if (error && !session) return <p className="text-sm text-red-600">{error}</p>;
  if (!session) return <p className="text-sm text-zinc-500">読み込み中…</p>;

  if (session.status === "completed") {
    return (
      <div className="rounded-2xl border border-teal-800/50 bg-teal-950/30 p-6 text-center text-sm text-teal-100/95 dark:border-teal-700/40">
        <p className="font-medium">日程を確定しました。</p>
        <p className="mt-2 text-xs text-teal-200/90">
          主催者（Aさん）のカレンダーに反映され、通知が届きます。
        </p>
      </div>
    );
  }

  if (session.status === "participant_declined") {
    return (
      <div className="rounded-2xl border border-zinc-600 bg-zinc-900/80 p-6 text-center text-sm text-zinc-200">
        <p className="font-medium">候補は見送りました</p>
        <p className="mt-2 text-xs text-zinc-500">主催者（Aさん）へ伝わっています。</p>
      </div>
    );
  }

  if (session.status === "awaiting_organizer_confirm") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm dark:border-zinc-800 dark:bg-zinc-900">
        この調整は旧形式のままです。主催者に確認してください。
      </div>
    );
  }

  if (session.status === "awaiting_organizer_final") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm dark:border-zinc-800 dark:bg-zinc-900">
        回答を送信しました。主催者の最終調整をお待ちください。
      </div>
    );
  }

  if (!canAnswerOld && !canAnswerNew) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm dark:border-zinc-800 dark:bg-zinc-900">
        この調整はすでに次の段階に進んでいます。主催者に確認してください。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-lg font-bold">日程の候補</h1>
        <p className="text-xs text-zinc-500">
          {canAnswerNew
            ? "日付は変えられません。必要なら時間だけ変更し、都合のよい枠にチェックを入れて確定してください（複数可）。確定内容が主催者の Google カレンダーに反映されます。"
            : "都合のよい枠を選んで送信してください（複数可）。"}
        </p>
      </header>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="flex flex-col gap-2">
        {choices.map((s) => (
          <li key={s.id}>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="mt-0.5"
                />
                {canAnswerNew ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {dateLabelFromSlot(s)}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                      <input
                        type="time"
                        className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                        value={slotTimes[s.id]?.start ?? hmFromIsoInJst(s.start)}
                        onChange={(e) =>
                          setSlotTimes((prev) => ({
                            ...prev,
                            [s.id]: {
                              start: e.target.value,
                              end: prev[s.id]?.end ?? hmFromIsoInJst(s.end),
                            },
                          }))
                        }
                      />
                      <span className="text-zinc-500">〜</span>
                      <input
                        type="time"
                        className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                        value={slotTimes[s.id]?.end ?? hmFromIsoInJst(s.end)}
                        onChange={(e) =>
                          setSlotTimes((prev) => ({
                            ...prev,
                            [s.id]: {
                              start: prev[s.id]?.start ?? hmFromIsoInJst(s.start),
                              end: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-sm">{s.label}</span>
                )}
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        {canAnswerNew && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void rejectSchedule()}
            className="w-full rounded-xl border border-rose-600/80 bg-rose-950/40 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-950/60 disabled:opacity-50"
          >
            どの日程も合わない（見送る）
          </button>
        )}
        <button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={() => void submit()}
          className="rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {canAnswerNew ? "確定する" : "送信"}
        </button>
      </div>
    </div>
  );
}
