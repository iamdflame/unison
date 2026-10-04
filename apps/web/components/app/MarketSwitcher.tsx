"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { preloadable, whenIdle } from "@/lib/ui/lazy";

const MarketPalette = preloadable(() => import("./MarketPalette").then((m) => m.MarketPalette));

/** ⌘K: jump to any market, or anywhere in the app. The palette is fetched while the app is idle. */
export function MarketSwitcher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  const router = useRouter();

  useEffect(() => {
    whenIdle(MarketPalette.preload);
    const on = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={MarketPalette.preload}
        onFocus={MarketPalette.preload}
        className="press hidden items-center gap-2 rounded-full bg-sunken px-3 py-1.5 text-sm text-ink-3 transition-colors hover-fine:text-ink md:inline-flex"
        aria-label="Search markets"
      >
        <Search size={14} strokeWidth={1.5} aria-hidden /> Search
        <kbd className="ml-3 rounded-md border border-line px-1.5 text-[11px] text-ink-3">⌘K</kbd>
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <MarketPalette open={open} onOpenChange={setOpen} go={go} />
        </Suspense>
      ) : null}
    </>
  );
}
