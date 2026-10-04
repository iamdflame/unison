"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Emblem } from "@/components/brand/Emblem";
import { Lockup } from "@/components/brand/Lockup";
import { ThemeMenu } from "@/components/ui/ThemeMenu";
import { MobileMenu } from "./MobileMenu";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/fairness", label: "Fairness" },
  { href: "/developers", label: "Developers" },
];

/** A single sapphire pill. It tightens a little once the page scrolls; it never hides the content it sits over. */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(12px,env(safe-area-inset-top))]">
      <nav
        aria-label="Primary"
        data-scrolled={scrolled || undefined}
        className="glass pointer-events-auto flex w-full max-w-[760px] items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4 shadow-md transition-[padding,box-shadow] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-[scrolled]:shadow-lg"
      >
        <Link href="/" className="flex items-center rounded-full py-1.5 pr-2 outline-offset-4" aria-label="Unison, home">
          <Lockup capHeight={11.5} className="hidden translate-y-[2px] sm:block" title="" />
          <Emblem size={24} jewel className="sm:hidden" />
        </Link>
        <ul className="mx-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="rounded-full px-3.5 py-2 text-[13.5px] font-medium text-ink-2 transition-colors duration-150 hover-fine:text-ink"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <MobileMenu />
          <ThemeMenu />
          <Link
            href="/trade/aNVDA"
            className="press tap rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-bg shadow-sm hover-fine:opacity-90"
          >
            Start trading
          </Link>
        </div>
      </nav>
    </header>
  );
}
