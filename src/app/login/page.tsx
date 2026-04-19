"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") ? next : "/";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(actor: "a" | "b") {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/msa/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor }),
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? "ログインに失敗しました");
      }
      router.replace(safeNext);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ログインに失敗しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">誰として使うか</h1>
        <p className="mt-2 text-sm text-zinc-400">
          A さん＝主催者、B さん＝参加者です。サーバー環境変数でメールとユーザー ID が紐づいています。
        </p>
      </header>
      {error && (
        <p className="rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => void choose("a")}
          className="rounded-2xl border border-teal-700/50 bg-teal-950/40 px-4 py-4 text-left text-base font-semibold text-teal-100 ring-1 ring-teal-800/50 transition hover:bg-teal-900/50 disabled:opacity-50"
        >
          <span className="block text-lg">A さん（主催者）</span>
          <span className="mt-1 block text-xs font-normal text-teal-200/80">
            日程の作成・候補送信・確定
          </span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void choose("b")}
          className="rounded-2xl border border-zinc-600 bg-zinc-900/80 px-4 py-4 text-left text-base font-semibold text-zinc-100 ring-1 ring-zinc-800 transition hover:bg-zinc-800 disabled:opacity-50"
        >
          <span className="block text-lg">B さん（参加者）</span>
          <span className="mt-1 block text-xs font-normal text-zinc-400">
            受信トレイ・参加者としての回答
          </span>
        </button>
      </div>
      {pending && (
        <p className="text-center text-sm text-teal-400">切り替えています…</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="py-16 text-center text-sm text-zinc-500">読み込み中…</p>}>
      <LoginForm />
    </Suspense>
  );
}
