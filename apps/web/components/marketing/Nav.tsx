"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeMenu } from "@/components/ui/ThemeMenu";
import { site } from "@/lib/content/site";
import { Hallmark } from "@/components/ui/Hallmark";
import { MobileMenu } from "./MobileMenu";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/fairness", label: "Fairness" },
  { href: "/developers", label: "Developers" },
];

/**
 * A full-width bar of sapphire on a hairline, the way a maison's site and Apple's are ruled: the lockup, the stage as
 * a hallmark, text links, and one quiet action. It firms up once the page scrolls; it never hides the content it
 * sits over. `brand` is drawn by the (server) layout, so the lockup's outlines reach the page as markup, not JavaScript.
 */
export function Nav({ brand }: { brand: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      data-scrolled={scrolled || undefined}
      className="glass fixed inset-x-0 top-0 z-50 border-b border-transparent pt-[env(safe-area-inset-top)] transition-[border-color] duration-[240ms] data-[scrolled]:border-line"
    >
      <nav aria-label="Primary" className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center py-1.5 pr-1 outline-offset-4" aria-label="Unison, home">
          {brand}
        </Link>
        {/* the venue's stage, as a hallmark: small capitals in a hairline box */}
        <Hallmark className="hidden sm:inline-flex">{site.stage}</Hallmark>
        <ul className="ml-6 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="px-3 py-2 text-[13.5px] font-medium text-ink-2 transition-colors duration-150 hover-fine:text-ink">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1.5">
          <MobileMenu />
          <ThemeMenu />
          <Link
            href="/trade/aNVDA"
            className="press tap rounded-[var(--radius-sm)] bg-ink px-3.5 py-2 text-[13.5px] font-semibold text-bg hover-fine:opacity-90"
          >
            Start trading
          </Link>
        </div>
      </nav>
    </header>
  );
}
