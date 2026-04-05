"use client";

import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuthOauthProviders } from "@/lib/supabase/oauth-providers";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const err = searchParams.get("error");
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  /** 既存セッション確認が終わるまで Auth を出さない（誤って二重送信しにくくする） */
  const [sessionChecked, setSessionChecked] = useState(false);

  const supabase = useMemo(() => createClient(), []);
  const oauthProviders = useMemo(() => getAuthOauthProviders(), []);

  const safeNext = next.startsWith("/") ? next : "/";

  useEffect(() => {
    setCallbackUrl(
      `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
    );
  }, [safeNext]);

  /** Auth UI はログイン成功後も画面遷移しないことがあるため、セッション確立でアプリへ送る */
  useEffect(() => {
    if (!supabase) {
      setSessionChecked(true);
      return;
    }

    let cancelled = false;

    function goHome() {
      if (cancelled) return;
      setRedirecting(true);
      router.replace(safeNext);
      router.refresh();
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        goHome();
      } else {
        setSessionChecked(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        goHome();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, router, safeNext]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">ログイン</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {oauthProviders.length > 0
            ? "メール・マジックリンク、または連携したアカウントでサインインできます。"
            : "メールアドレスとパスワード、またはマジックリンクでサインインできます。"}
        </p>
      </header>
      {(err === "auth" || err === "config") && (
        <p className="rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {err === "config"
            ? "Supabase の環境変数が設定されていません。.env.local を確認してください。"
            : "認証に失敗しました。もう一度お試しください。"}
        </p>
      )}
      {!isSupabaseConfigured() && (
        <p className="rounded-xl border border-amber-900/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          .env.local に <code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> と{" "}
          <code className="text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> を設定してください。
        </p>
      )}
      {redirecting && (
        <p className="text-center text-sm text-teal-400">ログインしました。移動しています…</p>
      )}
      {isSupabaseConfigured() &&
        supabase &&
        callbackUrl &&
        !redirecting &&
        sessionChecked && (
        <div className="msa-auth-ui rounded-2xl border border-zinc-700 bg-zinc-900/80 p-4 ring-1 ring-zinc-800 [&_.supabase-auth-ui_ui-message]:text-sm">
          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: "#0d9488",
                    brandAccent: "#14b8a6",
                    inputBackground: "#27272a",
                    inputText: "#fafafa",
                    inputPlaceholder: "#a1a1aa",
                    inputBorder: "#52525b",
                  },
                },
              },
            }}
            theme="default"
            providers={oauthProviders}
            redirectTo={callbackUrl}
            view="sign_in"
            showLinks
            magicLink
            dark
            socialLayout="vertical"
          />
        </div>
      )}
      {isSupabaseConfigured() && supabase && !callbackUrl && (
        <p className="text-center text-sm text-zinc-500">読み込み中…</p>
      )}
      {isSupabaseConfigured() && supabase && callbackUrl && !redirecting && !sessionChecked && (
        <p className="text-center text-sm text-zinc-500">セッションを確認しています…</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-zinc-500">読み込み中…</p>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
