"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeMenu } from "@/components/ui/ThemeMenu";
import dynamic from "next/dynamic";
import { AccountButton } from "./AccountButton";
import { MarketSwitcher } from "./MarketSwitcher";

const VenuePill = dynamic(() => import("./VenuePill"), { ssr: false });

const NAV = [
  { href: "/trade/aNVDA", label: "Trade", match: "/trade" },
  { href: "/markets", label: "Markets", match: "/markets" },
  { href: "/portfolio", label: "Portfolio", match: "/portfolio" },
  { href: "/vaults", label: "Vaults", match: "/vaults" },
  { href: "/keys", label: "Agents", match: "/keys" },
];

/** The app's instrument bar: home, navigation, the beat of the active market, and you. `mark` is drawn by the server. */
export function TopBar({ mark }: { mark: ReactNode }) {
  const path = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl [@media(prefers-reduced-transparency:reduce)]:bg-bg">
      <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Unison home" className="rounded-full p-1">
          {mark}
        </Link>
        <nav aria-label="App" className="ml-2 hidden items-center gap-0.5 sm:flex">
          {NAV.map((n) => {
            const on = path.startsWith(n.match);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${on ? "bg-ink/[0.07] text-ink" : "text-ink-2 hover-fine:text-ink"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <MarketSwitcher />
          <VenuePill />
          <ThemeMenu />
          <AccountButton />
        </div>
      </div>
    </header>
  );
}
