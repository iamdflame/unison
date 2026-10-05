"use client";

import { useEffect, useId, useRef } from "react";
import { endTour, startTour } from "@/lib/ui/tour";

/**
 * The offer of a tour, on a first visit to the terminal: a small card in a corner that asks once and never blocks
 * the page. "Not now" is remembered, as finishing the tour is; Esc declines it while it has focus.
 */
export function TourInvite({ preload }: { preload: () => void }) {
  const title = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.contains(document.activeElement)) endTour("dismissed");
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <section
      ref={ref}
      aria-labelledby={title}
      // above the Buy and Sell bar (and the tab bar under it, on a phone); a corner of its own on a desktop
      className="fixed inset-x-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-[var(--radius-xl)] bg-raised p-5 shadow-float motion-safe:animate-[rise-in_260ms_cubic-bezier(0.23,1,0.32,1)] sm:bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:inset-x-auto lg:bottom-6 lg:left-6 lg:w-[340px]"
    >
      <p className="text-xs text-ink-3">New to Unison?</p>
      <h2 id={title} className="text-display-s mt-1.5 text-ink">
        Take the one-minute tour
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        This screen, part by part: the auction, the chart, and how to place your first order.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={startTour}
          onPointerEnter={preload}
          onFocus={preload}
          className="press rounded-[var(--radius-sm)] bg-ink px-4 py-2.5 text-sm font-semibold text-bg"
        >
          Take the tour
        </button>
        <button
          type="button"
          onClick={() => endTour("dismissed")}
          className="press rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-medium text-ink-2 hover-fine:text-ink"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
