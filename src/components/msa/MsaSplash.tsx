"use client";

import { useEffect, useState } from "react";

/** フルリロードのたびに約 1.4 秒表示（同一タブ内のクライアント遷移ではレイアウトが残るため再表示されません） */
export function MsaSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), 1400);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0f766e] text-white motion-safe:transition-opacity motion-safe:duration-300"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-hidden
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.35em] text-white/80">
          Meet Schedule
        </p>
        <p className="text-5xl font-black tracking-tight sm:text-6xl">MSA</p>
        <p className="max-w-xs text-sm text-white/85">日程調整をここから</p>
      </div>
    </div>
  );
}
