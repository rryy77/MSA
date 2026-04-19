"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Slot = { id: string; label: string };

type Session = {
  id: string;
  status: string;
  slots: Slot[];
  organizerRound1Ids: string[];
  participantIds: string[];
  participantToken: string;
};

export default function ParticipantPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  const canAnswerOld =
    session?.status === "awaiting_participant";
  const canAnswerNew =
    session?.status === "awaiting_participant_availability";

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
            ? "都合のよい枠にチェックを入れて確定してください（複数可）。確定すると主催者の Google カレンダーに反映されます。"
            : "都合のよい枠を選んで送信してください（複数可）。"}
        </p>
      </header>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="flex flex-col gap-2">
        {choices.map((s) => (
          <li key={s.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-0.5"
              />
              <span className="text-sm">{s.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={pending || selected.size === 0}
        onClick={() => void submit()}
        className="rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {canAnswerNew ? "確定する" : "送信"}
      </button>
    </div>
  );
}
