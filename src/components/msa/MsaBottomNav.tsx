"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "メッセージ", icon: MessageIcon },
  { href: "/settings", label: "設定", icon: SettingsIcon },
] as const;

export function MsaBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur-md"
      aria-label="メイン"
    >
      <div className="mx-auto flex max-w-2xl">
        {items.map(({ href, label, icon: Icon }) => {
          const isSettings = pathname.startsWith("/settings");
          const active = href === "/settings" ? isSettings : !isSettings;
          return (
            <Link
              key={href}
              href={href}
              className={
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.7rem] font-medium transition-colors " +
                (active
                  ? "text-teal-700 dark:text-teal-400"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200")
              }
            >
              <Icon active={active} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function MessageIcon({ active }: { active: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4 3v-3H6a2 2 0 0 1-2-2V5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        className={active ? "text-teal-600 dark:text-teal-400" : "text-zinc-400"}
      />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.75"
        className={active ? "text-teal-600 dark:text-teal-400" : "text-zinc-400"}
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06c.52.35 1.2.42 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .66.43 1.26 1 1.51.52.2 1.12.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.52.87.89 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.25"
        className={active ? "text-teal-600 dark:text-teal-400" : "text-zinc-400"}
      />
    </svg>
  );
}
