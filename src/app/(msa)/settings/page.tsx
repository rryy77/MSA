"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SKIP_AUTO_KEY = "msa_calendar_skip_auto";

function startGoogleCalendarOAuth() {
  window.location.href = "/api/google/calendar/oauth";
}

export default function SettingsPage() {
  const router = useRouter();
  const oauthCallbackRef = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [calLoading, setCalLoading] = useState(true);
  const [calStatus, setCalStatus] = useState<{
    connected: boolean;
    oauthConfigured: boolean;
    loggedIn: boolean;
  } | null>(null);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  /** null = モーダルなし。0 になったら即リダイレクト */
  const [autoOAuthCountdown, setAutoOAuthCountdown] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auto_calendar") === "1") {
      try {
        sessionStorage.removeItem(SKIP_AUTO_KEY);
      } catch {
        /* ignore */
      }
    }
    const cal = params.get("calendar");
    oauthCallbackRef.current = cal;
    if (cal === "connected") {
      try {
        sessionStorage.removeItem(SKIP_AUTO_KEY);
      } catch {
        /* ignore */
      }
      setCalMsg("Google カレンダーと連携しました。日程確定時に Meet 付きでイベントが作成されます。");
    } else if (cal === "error") {
      setCalMsg("連携に失敗しました。もう一度お試しください。");
    } else if (cal === "no_refresh") {
      setCalMsg(
        "リフレッシュトークンを取得できませんでした。Google の連携を一度解除し、再度「連携する」から試してください（同意画面でカレンダー権限を付与してください）。",
      );
    }
    if (cal) {
      router.replace("/settings", { scroll: false });
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/google/calendar/status")
      .then((r) => r.json())
      .then(
        (j: {
          connected?: boolean;
          oauthConfigured?: boolean;
          loggedIn?: boolean;
        }) => {
          if (!cancelled && typeof j.oauthConfigured === "boolean") {
            setCalStatus({
              connected: Boolean(j.connected),
              oauthConfigured: j.oauthConfigured,
              loggedIn: j.loggedIn !== false,
            });
          }
        },
      )
      .catch(() => {
        if (!cancelled) {
          setCalStatus({
            connected: false,
            oauthConfigured: false,
            loggedIn: false,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setCalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 未連携かつ OAuth 設定ありのとき、この画面で自動的に Google 認証へ誘導（失敗直後・「あとで」選択時はスキップ） */
  useEffect(() => {
    if (
      calLoading ||
      !calStatus?.oauthConfigured ||
      !calStatus.loggedIn ||
      calStatus.connected
    ) {
      return;
    }
    const fromCallback = oauthCallbackRef.current;
    if (fromCallback === "error" || fromCallback === "no_refresh") return;
    try {
      if (sessionStorage.getItem(SKIP_AUTO_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setAutoOAuthCountdown(5);
  }, [calLoading, calStatus]);

  useEffect(() => {
    if (autoOAuthCountdown === null) return;
    if (autoOAuthCountdown <= 0) {
      startGoogleCalendarOAuth();
      return;
    }
    const t = window.setTimeout(() => {
      setAutoOAuthCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [autoOAuthCountdown]);

  function cancelAutoOAuth() {
    try {
      sessionStorage.setItem(SKIP_AUTO_KEY, "1");
    } catch {
      /* ignore */
    }
    setAutoOAuthCountdown(null);
  }

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

  async function disconnectCalendar() {
    setPending(true);
    try {
      const res = await fetch("/api/google/calendar/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("disconnect_failed");
      setCalStatus((s) => (s ? { ...s, connected: false } : null));
      setCalMsg("Google カレンダーとの連携を解除しました。");
    } catch {
      setCalMsg("連携の解除に失敗しました。もう一度お試しください。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-1 flex-col justify-center gap-4 sm:min-h-[min(100%,36rem)]">
      {autoOAuthCountdown !== null && autoOAuthCountdown > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="msa-cal-oauth-title"
        >
          <div className="max-w-md rounded-2xl border border-zinc-600 bg-zinc-900 p-6 shadow-xl ring-1 ring-zinc-800">
            <h2
              id="msa-cal-oauth-title"
              className="text-lg font-bold tracking-tight text-zinc-100"
            >
              Google カレンダーの許可
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              日程を確定したときに Meet 付きの予定を作るには、Google にカレンダーへのアクセスを許可する必要があります。まもなく Google のログイン・同意画面に移動します。
            </p>
            <p className="mt-6 text-center text-4xl font-bold tabular-nums text-teal-400">
              {autoOAuthCountdown}
            </p>
            <p className="mt-1 text-center text-xs text-zinc-500">秒後に移動します</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => cancelAutoOAuth()}
                className="rounded-xl border border-zinc-600 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                あとで（この画面に留まる）
              </button>
              <button
                type="button"
                onClick={() => startGoogleCalendarOAuth()}
                className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-500"
              >
                今すぐ認証へ
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="shrink-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">設定</h1>
        <p className="mt-1 text-sm text-zinc-400">
          アカウントは Supabase（Google ログイン）で管理されています。
        </p>
      </header>
      {calMsg && (
        <p className="rounded-xl border border-teal-700/40 bg-teal-950/25 px-3 py-2 text-sm text-teal-100/95 dark:border-teal-600/40">
          {calMsg}
        </p>
      )}
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
          <p className="mt-1 text-xs text-zinc-500">
            日程を確定したとき、主催者のカレンダーに Meet 付きの予定を追加し、参加者に招待メールが届きます。
          </p>
          {calLoading ? (
            <p className="mt-2 text-xs text-zinc-500">読み込み中…</p>
          ) : !calStatus?.oauthConfigured ? (
            <p className="mt-2 text-xs text-amber-200/90">
              この環境では Google OAuth（GOOGLE_OAUTH_CLIENT_ID 等）が未設定のため、連携できません。
            </p>
          ) : !calStatus.loggedIn ? (
            <p className="mt-2 text-xs text-zinc-400">
              カレンダー連携はログイン中のアカウントに保存されます。{" "}
              <Link
                href="/login?next=%2Fsettings"
                className="font-medium text-teal-400 underline hover:text-teal-300"
              >
                ログイン
              </Link>
              してから連携してください。
            </p>
          ) : calStatus.connected ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-lg border border-teal-700/50 bg-teal-950/40 px-3 py-1.5 text-xs font-medium text-teal-200">
                連携済み
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => void disconnectCalendar()}
                className="rounded-xl border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
              >
                連携を解除
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-zinc-400">
                開いたときに自動で Google の認証画面へ進みます。キャンセルした場合は、下のボタンからいつでも連携できます。
              </p>
              <button
                type="button"
                onClick={() => startGoogleCalendarOAuth()}
                className="inline-flex rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
              >
                カレンダーと連携する（手動）
              </button>
            </div>
          )}
        </li>
        <li className="px-4 py-4">
          <p className="text-sm font-medium">MSA について</p>
          <p className="mt-1 text-xs text-zinc-500">Meet Schedule Assistant</p>
        </li>
      </ul>
    </div>
  );
}
