"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { createStore } from "@/lib/store/createStore";
import { preloadable, whenIdle } from "@/lib/ui/lazy";

const MarketPalette = preloadable(() => import("./MarketPalette").then((m) => m.MarketPalette));

/**
 * ⌘K presses, counted from the moment this module loads. A listener added in an effect would miss a press made after
 * the page looks ready but before React has run its effects (the browser would take it instead); counted here, every
 * press is answered as soon as the switcher renders.
 */
const presses = createStore(0);
const noop = () => () => {};
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      presses.set((n) => n + 1);
    }
  });
}

/** ⌘K: jump to any market, or anywhere in the app. The palette is fetched while the app is idle. */
export function MarketSwitcher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  // the server saw no presses; one made before hydration is answered on the render right after it
  const pressed = useSyncExternalStore(presses.subscribe, presses.get, () => 0);
  const [answered, setAnswered] = useState(0);
  if (pressed !== answered) {
    setAnswered(pressed);
    if ((pressed - answered) % 2 === 1) setOpen((o) => !o);
  }
  const router = useRouter();
  const mac = useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => true,
  );

  useEffect(() => {
    whenIdle(MarketPalette.preload);
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
        className="press hidden items-center gap-2 rounded-[var(--radius-sm)] bg-sunken px-3 py-1.5 text-sm text-ink-3 transition-colors hover-fine:text-ink md:inline-flex"
        aria-label="Search markets"
      >
        <Search size={14} strokeWidth={1.5} aria-hidden /> Search
        <kbd className="ml-3 rounded-md border border-line px-1.5 text-[11px] text-ink-3">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <MarketPalette open={open} onOpenChange={setOpen} go={go} />
        </Suspense>
      ) : null}
    </>
  );
}
