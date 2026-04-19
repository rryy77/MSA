"use client";

import { useEffect, useRef } from "react";

export type MsaPollRefreshOptions = {
  /** 既定 20 秒 */
  intervalMs?: number;
  enabled?: boolean;
  /** 変わったらフィンガープリントをリセット（例: セッション id） */
  resetKey?: string | number | null;
};

/**
 * サーバー上のデータ更新（受信トレイ・セッション状態など）をポーリングで検知し、
 * 変化時に onChange（通常は一覧の再 fetch）を呼ぶ。タブが非表示のときはポーリングしない。
 */
export function useMsaPollRefresh(
  getFingerprint: () => Promise<string>,
  onChange: () => void | Promise<void>,
  options?: MsaPollRefreshOptions,
): void {
  const fpRef = useRef(getFingerprint);
  const onRef = useRef(onChange);
  fpRef.current = getFingerprint;
  onRef.current = onChange;

  const lastRef = useRef<string | null>(null);
  const intervalMs = options?.intervalMs ?? 20_000;
  const enabled = options?.enabled ?? true;
  const resetKey = options?.resetKey;

  useEffect(() => {
    if (!enabled) return;
    lastRef.current = null;

    let cancelled = false;

    async function tick() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const fp = await fpRef.current();
        if (cancelled) return;
        if (lastRef.current === null) {
          lastRef.current = fp;
          return;
        }
        if (fp !== lastRef.current) {
          lastRef.current = fp;
          await onRef.current();
        }
      } catch {
        /* 一時的なネットワーク失敗は無視 */
      }
    }

    void tick();

    const id = window.setInterval(() => void tick(), intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, intervalMs, resetKey]);
}
