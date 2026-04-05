"use client";

import type { ReactNode } from "react";
import { MsaSplash } from "./MsaSplash";
import { MsaBottomNav } from "./MsaBottomNav";

export function MsaShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <MsaSplash />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-24 pt-4 sm:px-8 sm:pt-6">
        <div className="flex min-h-[calc(100dvh-5.5rem)] flex-1 flex-col">{children}</div>
      </main>
      <MsaBottomNav />
    </div>
  );
}
