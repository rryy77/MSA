"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMsaPollRefresh } from "@/hooks/useMsaPollRefresh";

type Summary = {
  id: string;
  status: string;
  triggerDateJst: string;
  triggerAt: string;
};

type InboxRow = {
  id: string;
  session_id: string;
  subject: string;
  invite_url: string;
  created_at: string;
  read_at: string | null;
  text_body: string;
  html_body: string;
};

const statusLabel: Record<string, string> = {
  awaiting_organizer_round1: "主催: 候補作成・送信前",
  awaiting_participant_availability: "参加者の回答待ち",
  awaiting_organizer_confirm: "主催: 確定待ち",
  awaiting_participant: "参加者の回答待ち（旧）",
  awaiting_organizer_final: "主催: 最終（旧）",
  completed: "完了",
};

export default function MessagePage() {
  const [sessions, setSessions] = useState<Summary[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [role, setRole] = useState<"organizer" | "participant" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const me = await fetch("/api/msa/session", { cache: "no-store", credentials: "include" });
      const meJ = (await me.json().catch(() => ({}))) as {
        configured?: boolean;
        actor?: string;
        role?: string;
      };
      if (!me.ok || !meJ.role) {
        setRole(null);
        setSessions([]);
        setInbox([]);
        setError("セッションを確認できません。ログインし直してください。");
        return;
      }
      const r = meJ.role === "organizer" ? "organizer" : "participant";
      setRole(r);

      const ir = await fetch("/api/inbox", { cache: "no-store", credentials: "include" });
      const irText = await ir.text();
      if (!ir.ok) {
        setInbox([]);
        let ij: { error?: string; detail?: string } = {};
        try {
          ij = JSON.parse(irText) as { error?: string; detail?: string };
        } catch {
          /* ignore */
        }
        const hint =
          ij.detail ||
          (ij.error === "inbox_fetch_failed"
            ? "テーブル invite_notifications が無い可能性があります。Supabase のマイグレーションを確認してください。"
            : null);
        setError(
          hint
            ? `受信トレイを読み込めません: ${hint}`
            : "受信トレイを読み込めませんでした。",
        );
      } else {
        try {
          const iData = JSON.parse(irText) as { items?: InboxRow[] };
          setInbox(iData.items ?? []);
        } catch {
          setInbox([]);
        }
      }

      if (r === "organizer") {
        const sr = await fetch("/api/sessions", { cache: "no-store", credentials: "include" });
        const sJson = (await sr.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          sessions?: Summary[];
        };
        if (!sr.ok) {
          setSessions([]);
          setError(
            typeof sJson.message === "string"
              ? sJson.message
              : `日程一覧を読み込めません（HTTP ${sr.status}）`,
          );
        } else {
          setSessions(sJson.sessions ?? []);
        }
      } else {
        setSessions([]);
      }
    } catch {
      setError("一覧を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const inboxSessionsFingerprint = useCallback(async () => {
    const inboxR = await fetch("/api/inbox", { cache: "no-store", credentials: "include" });
    let inboxPart = "inbox:err";
    if (inboxR.ok) {
      const j = (await inboxR.json().catch(() => ({}))) as { items?: InboxRow[] };
      const items = j.items ?? [];
      inboxPart = items
        .map((i) => `${i.id}:${i.read_at ?? ""}:${i.created_at}`)
        .sort()
        .join("|");
    }
    const sessR = await fetch("/api/sessions", { cache: "no-store", credentials: "include" });
    let sessPart = `sess:${sessR.status}`;
    if (sessR.ok) {
      const j = (await sessR.json().catch(() => ({}))) as { sessions?: Summary[] };
      const sessions = j.sessions ?? [];
      sessPart = sessions
        .map((s) => `${s.id}:${s.status}:${s.triggerAt}`)
        .sort()
        .join("|");
    }
    return `${inboxPart}##${sessPart}`;
  }, []);

  useMsaPollRefresh(inboxSessionsFingerprint, load, {
    intervalMs: 15_000,
  });

  async function markRead(id: string) {
    try {
      await fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      setInbox((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, read_at: x.read_at ?? new Date().toISOString() } : x,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  function toggleOpen(row: InboxRow) {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    if (!row.read_at) void markRead(row.id);
  }

  return (
    <div className="flex min-h-full flex-1 flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">メッセージ</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {role === "organizer"
            ? "A（主催者）としてログイン中です。"
            : role === "participant"
              ? "B（参加者）としてログイン中です。"
              : ""}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">受信トレイ（参加案内）</h2>
        {loading ? (
          <p className="text-sm text-zinc-500">読み込み中…</p>
        ) : inbox.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center text-sm text-zinc-500">
            参加案内はまだありません。主催者（A）が候補を送るとここに表示されます。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {inbox.map((row) => (
              <li key={row.id} className="rounded-xl border border-zinc-700 bg-zinc-900/80 ring-1 ring-zinc-800">
                <button
                  type="button"
                  onClick={() => toggleOpen(row)}
                  className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left"
                >
                  <span className="flex w-full items-center gap-2">
                    {!row.read_at && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-teal-500" aria-hidden />
                    )}
                    <span className="font-medium text-zinc-100">{row.subject}</span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {new Date(row.created_at).toLocaleString("ja-JP")}
                  </span>
                </button>
                {openId === row.id && (
                  <div className="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
                    <div
                      className="text-sm leading-relaxed text-zinc-300 [&_a]:text-teal-400 [&_p]:my-2 [&_ul]:my-2 [&_li]:my-0.5"
                      dangerouslySetInnerHTML={{ __html: row.html_body }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {role === "organizer" && (
        <section className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 shadow-sm ring-1 ring-zinc-800">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/schedule"
              className="flex-1 rounded-xl bg-teal-600 px-4 py-3.5 text-center text-base font-semibold text-white shadow-sm transition hover:bg-teal-500"
            >
              予定作成
            </Link>
            <Link
              href="/schedule?view=confirm"
              className="flex-1 rounded-xl border border-zinc-600 bg-zinc-800 px-4 py-3.5 text-center text-base font-semibold text-zinc-100 transition hover:bg-zinc-700"
            >
              予定確認
            </Link>
          </div>
          <p className="mt-3 text-center text-xs text-zinc-500">
            候補作成後、B さんへはメール入力なしで送信できます。
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">
          {role === "participant" ? "進行中の調整（参照）" : "進行中の調整（主催）"}
        </h2>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        {loading ? (
          <p className="text-sm text-zinc-500">読み込み中…</p>
        ) : sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-700 px-4 py-8 text-center text-sm text-zinc-500">
            {role === "participant"
              ? "主催者の一覧は A さんの画面に表示されます。"
              : "まだありません。「予定作成」から始めてください。"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/session/${s.id}`}
                  className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition hover:border-teal-700 hover:bg-teal-950/40"
                >
                  <span className="font-medium">開始日 {s.triggerDateJst}</span>
                  <span className="text-xs text-zinc-500">{statusLabel[s.status] ?? s.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
