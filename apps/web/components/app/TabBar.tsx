"use client";

import { Bot, ChartPie, ChartSpline, LayoutList, Vault } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/trade/aNVDA", match: "/trade", label: "Trade", Icon: ChartSpline },
  { href: "/markets", match: "/markets", label: "Markets", Icon: LayoutList },
  { href: "/portfolio", match: "/portfolio", label: "Portfolio", Icon: ChartPie },
  { href: "/vaults", match: "/vaults", label: "Vaults", Icon: Vault },
  { href: "/keys", match: "/keys", label: "Agents", Icon: Bot },
] as const;

/** Phones get the app's sections under the thumb: one glass bar, above the home indicator. */
export function TabBar() {
  const path = usePathname();
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden [@media(prefers-reduced-transparency:reduce)]:bg-bg"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
        {TABS.map(({ href, match, label, Icon }) => {
          const on = path.startsWith(match);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`press flex h-full flex-col items-center justify-center gap-1 text-[11px] transition-colors duration-150 ${on ? "font-semibold text-ink" : "font-medium text-ink-3"}`}
              >
                <Icon size={22} strokeWidth={on ? 1.9 : 1.5} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
