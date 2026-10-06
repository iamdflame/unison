"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/motion/useInView";
import { estimatedBlock } from "@/lib/hero/feed";
import { facts } from "@/lib/content/facts";
import { BEAT_MS } from "@/lib/motion/tokens";

const CELLS = 60;

/**
 * Chapter 8's live instrument: a strip of blocks advancing one cell per beat (dead-beat), the block that just struck in
 * blued steel, the last ten fading. The only part of the chapter that runs in the browser.
 */
export function BlockStrip() {
  const ref = useRef<HTMLElement>(null);
  const live = useInView(ref, { threshold: 0.3, once: false });
  const [block, setBlock] = useState<number | null>(null);

  useEffect(() => {
    if (!live) return;
    const tick = () => setBlock(estimatedBlock(Date.now()));
    const first = setTimeout(tick, 0);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => clearTimeout(first);
    const id = setInterval(tick, BEAT_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [live]);

  return (
    <figure ref={ref}>
      {/* a beat counter: one graduation per block, the beat that just struck in blued steel, the last ten fading */}
      <div className="flex h-14 items-end justify-between border-b border-line-strong" aria-hidden>
        {Array.from({ length: CELLS }, (_, i) => {
          const head = block === null ? -1 : block % CELLS;
          const age = head < 0 ? CELLS : (head - i + CELLS) % CELLS;
          return (
            <div
              key={i}
              className={`w-[3px] rounded-t-[1px] ${age === 0 ? "h-full bg-accent" : age < 10 ? "h-9 bg-ink" : i % 5 === 0 ? "h-6 bg-ink-3/60" : "h-4 bg-ink-3/40"}`}
              style={{ opacity: age > 0 && age < 10 ? 0.9 - age * 0.07 : 1 }}
            />
          );
        })}
      </div>
      <figcaption className="mt-4 flex items-baseline justify-between text-sm text-ink-3">
        <span>One block, one batch, every {facts.beatMs} ms</span>
        <span className="tnum text-ink">{block ? `#${block.toLocaleString("en-US")}` : ""}</span>
      </figcaption>
    </figure>
  );
}
