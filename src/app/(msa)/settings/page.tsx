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
  const [lineLoading, setLineLoading] = useState(true);
  const [lineStatus, setLineStatus] = useState<{
    connected: boolean;
    loginConfigured: boolean;
    pushConfigured: boolean;
    loggedIn: boolean;
  } | null>(null);
  const [lineMsg, setLineMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auto_calendar") === "1") {
      try {
        sessionStorage.removeItem(SKIP_AUTO_KEY);
      } catch {
        /* ignore */
      }
    }
    const line = params.get("line");
    const lineReason = params.get("reason");
    if (line === "connected") {
      setLineMsg("LINE と連携しました。メール送信時に同じ趣旨の通知が届きます（公式アカウントを友だち追加済みである必要があります）。");
    } else if (line === "error") {
      setLineMsg(
        lineReason === "line_channel_not_configured"
          ? "サーバーに LINE Developers のチャネル ID / シークレットが未設定です。環境変数を確認してください。"
          : lineReason === "state_mismatch"
            ? "セッションの検証に失敗しました。もう一度「LINE と連携」から試してください。"
            : "LINE 連携に失敗しました。もう一度お試しください。",
      );
    }
    if (line) {
      router.replace("/settings", { scroll: false });
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/line/status")
      .then((r) => r.json())
      .then(
        (j: {
          connected?: boolean;
          loginConfigured?: boolean;
          pushConfigured?: boolean;
          loggedIn?: boolean;
        }) => {
          if (!cancelled && typeof j.loginConfigured === "boolean") {
            setLineStatus({
              connected: Boolean(j.connected),
              loginConfigured: Boolean(j.loginConfigured),
              pushConfigured: Boolean(j.pushConfigured),
              loggedIn: j.loggedIn !== false,
            });
          }
        },
      )
      .catch(() => {
        if (!cancelled) {
          setLineStatus({
            connected: false,
            loginConfigured: false,
            pushConfigured: false,
            loggedIn: false,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLineLoading(false);
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

  function startLineOAuth() {
    window.location.href = "/api/line/oauth";
  }

  async function disconnectLine() {
    setLineMsg(null);
    setPending(true);
    try {
      const res = await fetch("/api/profile/line", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disconnect: true }),
      });
      if (!res.ok) throw new Error("failed");
      setLineStatus((s) =>
        s ? { ...s, connected: false } : null,
      );
      setLineMsg("LINE 連携を解除しました。");
    } catch {
      setLineMsg("解除に失敗しました。");
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
            <p className="mt-2 text-xs leading-relaxed text-amber-200/90">
              このサーバーでは Google カレンダー用の OAuth が未設定です。Vercel の場合は Project →
              Settings → Environment Variables の Production に{" "}
              <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px] text-amber-100/95">
                GOOGLE_OAUTH_CLIENT_ID
              </code>{" "}
              と{" "}
              <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px] text-amber-100/95">
                GOOGLE_OAUTH_CLIENT_SECRET
              </code>{" "}
              を追加し、Google Cloud Console の「承認済みリダイレクト URI」と同じ URL になるよう{" "}
              <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px] text-amber-100/95">
                GOOGLE_CALENDAR_REDIRECT_URI
              </code>{" "}
              （または{" "}
              <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px] text-amber-100/95">
                NEXT_PUBLIC_APP_URL
              </code>
              ）を揃えて再デプロイしてください。詳細はリポジトリの{" "}
              <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px] text-amber-100/95">
                .env.example
              </code>{" "}
              を参照してください。
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
        <li className="border-b border-zinc-800 px-4 py-4">
          <p className="text-sm font-medium">LINE 通知（メールと同タイミング）</p>
          <p className="mt-1 text-xs text-zinc-500">
            <strong className="text-zinc-400">LINE Developers</strong> の Messaging API で、MSA
            からメールを送った直後に同じ趣旨のテキストを LINE にも送ります（アプリ内通知・プッシュとは別）。
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            連携後は、公式アカウントを<strong className="text-zinc-400">友だち追加</strong>
            している必要があります（未追加だと push が届きません）。
          </p>
          {lineMsg && (
            <p className="mt-2 text-xs text-teal-100/90">{lineMsg}</p>
          )}
          {lineLoading ? (
            <p className="mt-2 text-xs text-zinc-500">読み込み中…</p>
          ) : !lineStatus?.loginConfigured ? (
            <p className="mt-2 text-xs text-amber-200/90">
              サーバーに{" "}
              <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px]">LINE_CHANNEL_ID</code>{" "}
              と{" "}
              <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px]">LINE_CHANNEL_SECRET</code>{" "}
              が未設定です。LINE Developers のチャネル（LINE Login 有効）を用意し、環境変数とコールバック URL
              を設定してください（.env.example 参照）。
            </p>
          ) : !lineStatus.loggedIn ? (
            <p className="mt-2 text-xs text-zinc-400">
              <Link
                href="/login?next=%2Fsettings"
                className="font-medium text-teal-400 underline hover:text-teal-300"
              >
                ログイン
              </Link>
              してから連携してください。
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {!lineStatus.pushConfigured && (
                <p className="text-xs text-amber-200/90">
                  <code className="rounded bg-zinc-950 px-1 py-0.5 text-[11px]">
                    LINE_CHANNEL_ACCESS_TOKEN
                  </code>{" "}
                  が未設定のため、push は送信されません。Messaging API のチャネルアクセストークンを Vercel
                  等に設定してください。
                </p>
              )}
              {lineStatus.connected ? (
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg border border-teal-700/50 bg-teal-950/40 px-3 py-1.5 text-xs font-medium text-teal-200">
                    LINE と連携済み
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void disconnectLine()}
                    className="rounded-xl border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    連携を解除
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startLineOAuth()}
                  className="inline-flex rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  LINE と連携する
                </button>
              )}
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
