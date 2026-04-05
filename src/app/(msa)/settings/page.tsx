"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const supabase = createClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
      router.push("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col justify-center gap-4 sm:min-h-[min(100%,36rem)]">
      <header className="shrink-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">設定</h1>
        <p className="mt-1 text-sm text-zinc-400">
          アカウントは Supabase（Google ログイン）で管理されています。
        </p>
      </header>
      <ul className="shrink-0 rounded-2xl border border-zinc-700 bg-zinc-900/80 ring-1 ring-zinc-800">
        <li className="border-b border-zinc-800 px-4 py-4">
          <p className="text-sm font-medium">ログアウト</p>
          <p className="mt-1 text-xs text-zinc-500">この端末からセッションを終了します。</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void signOut()}
            className="mt-3 rounded-xl border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
          >
            {pending ? "処理中…" : "ログアウト"}
          </button>
        </li>
        <li className="border-b border-zinc-800 px-4 py-4">
          <p className="text-sm font-medium">Google カレンダー</p>
          <p className="mt-1 text-xs text-zinc-500">未接続（実装予定）</p>
        </li>
        <li className="px-4 py-4">
          <p className="text-sm font-medium">MSA について</p>
          <p className="mt-1 text-xs text-zinc-500">Meet Schedule Assistant</p>
        </li>
      </ul>
    </div>
  );
}
