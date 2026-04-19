"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TIMEZONE } from "@/lib/constants";

type Slot = { id: string; label: string; start: string; end: string };

type Session = {
  id: string;
  status: string;
  organizerRound1Ids: string[];
  slots: Slot[];
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

export default function RespondPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const [slotTimes, setSlotTimes] = useState<Record<string, { start: string; end: string }>>({});

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
      const res = await fetch(`/api/sessions/as-participant/${id}`, { cache: "no-store" });
      if (res.status === 401) {
        setError(
          "このURLはログインが必要な古い形式です。主催者から届いたメールに記載の「/p/ で始まるリンク」を開いてください（ログイン不要で回答できます）。",
        );
        return;
      }
      if (res.status === 403) {
        setError("この予定の参加者ではないか、既に回答済みです。");
        return;
      }
      if (res.status === 409) {
        setError("回答を受け付けている状態ではありません。");
        return;
      }
      if (!res.ok) throw new Error("failed");
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

  const slotById = useMemo(() => {
    if (!session?.slots?.length) return new Map<string, Slot>();
    return new Map(session.slots.map((s) => [s.id, s]));
  }, [session]);

  function toggle(sid: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      return n;
    });
  }

  const canAdjustTime = session?.status === "awaiting_participant_availability";

  async function submit() {
    if (!id || selected.size === 0) {
      setError("1つ以上選んでください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const slotTimeAdjustments = canAdjustTime
        ? Array.from(selected).map((sid) => {
            const slot = slotById.get(sid);
            if (!slot) throw new Error("slot");
            const t = slotTimes[sid];
            return {
              slotId: sid,
              timeStart: t?.start ?? hmFromIsoInJst(slot.start),
              timeEnd: t?.end ?? hmFromIsoInJst(slot.end),
            };
          })
        : undefined;
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "participant_submit_availability",
          slotIds: Array.from(selected),
          ...(slotTimeAdjustments?.length ? { slotTimeAdjustments } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j.error as string) || "failed");
      }
      setDone(true);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setPending(false);
    }
  }

  if (!id) {
    return <p className="py-12 text-center text-sm text-zinc-500">読み込み中…</p>;
  }

  if (done) {
    return (
      <p className="py-12 text-center text-sm text-zinc-400">
        送信しました。トップへ移動します…
      </p>
    );
  }

  if (error && !session) {
    return (
      <div className="flex flex-col gap-4 py-8">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/" className="text-sm text-teal-400 hover:underline">
          メッセージに戻る
        </Link>
      </div>
    );
  }

  if (!session) {
    return <p className="py-12 text-center text-sm text-zinc-500">読み込み中…</p>;
  }

  const choices = session.organizerRound1Ids
    .map((sid) => slotById.get(sid))
    .filter(Boolean) as Slot[];

  return (
    <div className="flex flex-1 flex-col gap-5 pb-8">
      <Link href="/" className="text-sm text-teal-400 hover:underline">
        ← メッセージに戻る
      </Link>
      <header>
        <h1 className="text-lg font-bold sm:text-xl">参加できる日程を選ぶ</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {canAdjustTime
            ? "日付は変えられません。必要なら時間だけ変更し、行ける候補にチェックを入れて確定してください。主催者の Google カレンダーに反映され、主催者へ通知が届きます。"
            : "行ける候補にチェックを入れて確定してください。主催者の Google カレンダーに反映され、主催者へ通知が届きます。"}
        </p>
      </header>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ul className="flex flex-col gap-2 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4">
        {choices.map((s) => (
          <li key={s.id}>
            <div className="rounded-lg border border-zinc-700 px-3 py-2">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="mt-1"
                />
                {canAdjustTime ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-100">{dateLabelFromSlot(s)}</span>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-200">
                      <input
                        type="time"
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1"
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
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1"
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
                  <span className="text-sm text-zinc-200">{s.label}</span>
                )}
              </label>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={pending || selected.size === 0}
        onClick={() => void submit()}
        className="w-full rounded-xl bg-teal-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "送信中…" : "確定する"}
      </button>
    </div>
  );
}
