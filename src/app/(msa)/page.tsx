"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export default function MessagePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        setError("セッションを確認できません。ログインし直してください。");
        return;
      }
      setRole(meJ.role === "organizer" ? "organizer" : "participant");
    } catch {
      setError("一覧を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

      {role === "organizer" && (
        <section className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 shadow-sm ring-1 ring-zinc-800">
          <Link
            href="/schedule"
            className="flex w-full items-center justify-center rounded-2xl bg-teal-600 px-6 py-6 text-center text-xl font-bold text-white shadow-md transition hover:bg-teal-500 active:scale-[0.99] sm:py-7 sm:text-2xl"
          >
            予定作成
          </Link>
        </section>
      )}

      {loading && <p className="text-sm text-zinc-500">読み込み中…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
