"use client";

import { useCallback, useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type Status =
  | "init"
  | "unsupported"
  | "no_vapid"
  | "prompt"
  | "denied"
  | "subscribed"
  | "error";

export function PushNotificationSettings() {
  const [status, setStatus] = useState<Status>("init");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const vapidPublic = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim();

  const syncSubscriptionState = useCallback(async () => {
    if (!vapidPublic) {
      setStatus("no_vapid");
      return;
    }
    if (typeof window === "undefined" || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    if (Notification.permission === "default") {
      setStatus("prompt");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "subscribed" : "prompt");
    } catch {
      setStatus("prompt");
    }
  }, [vapidPublic]);

  useEffect(() => {
    void syncSubscriptionState();
  }, [syncSubscriptionState]);

  async function enablePush() {
    if (!vapidPublic) return;
    setMessage(null);
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "prompt");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublic) as BufferSource,
        });
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "subscribe_failed");
      }
      setStatus("subscribed");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setMessage(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("prompt");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "解除に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (status === "init") {
    return (
      <p className="rounded-xl border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
        通知設定を読み込み中…
      </p>
    );
  }

  if (status === "unsupported") {
    return (
      <p className="rounded-xl border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
        このブラウザはブラウザ通知（Web Push）に対応していないか、制限があります。
      </p>
    );
  }

  if (status === "no_vapid") {
    return (
      <p className="rounded-xl border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90">
        Web Push 用の鍵が未設定です。サーバーの{" "}
        <code className="text-amber-100">NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY</code> などを設定してください。
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-3">
      <h2 className="text-sm font-semibold text-zinc-200">ブラウザ通知（Web Push）</h2>
      <p className="mt-1 text-xs text-zinc-500">
        許可すると、参加案内や日程の返信などを OS の通知で受け取れます（端末の通知設定に依存します）。
        iOS の Safari ではホーム画面に追加した PWA など、環境によっては利用できない場合があります。
      </p>
      {message && <p className="mt-2 text-xs text-red-400">{message}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {status === "denied" ? (
          <p className="text-xs text-amber-200/90">
            通知がブロックされています。ブラウザのサイト設定から通知を許可してください。
          </p>
        ) : status === "subscribed" ? (
          <button
            type="button"
            onClick={() => void disablePush()}
            disabled={busy}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? "処理中…" : "通知をオフにする"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enablePush()}
            disabled={busy}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {busy ? "処理中…" : "通知を許可して登録"}
          </button>
        )}
      </div>
    </section>
  );
}
