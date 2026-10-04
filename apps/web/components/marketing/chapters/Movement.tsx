"use client";

import { useRef, useState, type ReactNode } from "react";
import { useScrollProgress } from "@/components/motion/useScrollProgress";
import { PLATES } from "./movementPlates";

/**
 * Chapter 5: the movement. The system's six layers drawn as the watch parts that do the same job (jewelled top
 * plate, striped plate, escape wheel, balance, barrel, main plate), exploded on one axis as you scroll, the way a
 * maison's catalogue shows a calibre. The copy follows the part in focus. Reduced motion: shown already exploded.
 * The six drawings arrive as `plates`, in PLATES order, drawn by the server: they are static SVG.
 */
export function Movement({ plates }: { plates: ReactNode[] }) {
  const scope = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // The plates part as the pinned scene runs; the copy follows the part in focus. Under reduced motion the hook
  // stands down and the stage is drawn already exploded (motion-reduce:[--p:1]).
  useScrollProgress(scope, (p) => {
    stage.current?.style.setProperty("--p", p.toFixed(4));
    setActive(Math.min(PLATES.length - 1, Math.floor(p * PLATES.length * 0.999)));
  });

  return (
    <section ref={scope} aria-labelledby="movement-title" className="relative lg:h-[320vh]">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-x-12 px-5 py-28 sm:px-8 lg:sticky lg:top-0 lg:h-[100svh] lg:grid-cols-12 lg:px-12 lg:py-0">
        <div className="lg:col-span-5">
          <h2 id="movement-title" className="text-display-l text-ink">
            The movement.
          </h2>
          <p className="text-lede mt-6 max-w-md text-ink-2">
            Six layers, each with one job, open source and checked against each other on every batch.
          </p>
          <ol className="mt-10 space-y-1">
            {PLATES.map((p, i) => (
              <li key={p.name}>
                <div
                  className={`border-l-2 py-3 pl-5 transition-[border-color,opacity] duration-300 ${
                    i === active ? "border-ink" : "border-line"
                  }`}
                >
                  <p className={`text-[15px] font-semibold transition-colors duration-300 ${i === active ? "text-ink" : "text-ink-3"}`}>{p.name}</p>
                  <p className={`mt-1 max-w-md text-sm leading-relaxed text-ink-2 ${i === active ? "" : "lg:hidden motion-reduce:block"}`}>{p.line}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-16 lg:col-span-7 lg:mt-0">
          <div ref={stage} data-stage className="relative mx-auto aspect-square w-full max-w-[640px] [--p:0] [perspective:1800px] motion-reduce:[--p:1]" aria-hidden>
            <div className="absolute inset-0 [transform-style:preserve-3d] [transform:rotateX(58deg)_rotateZ(-38deg)]">
              {PLATES.map((p, i) => {
                const fromTop = PLATES.length - 1 - i;
                return (
                  <div
                    key={p.name}
                    className="absolute inset-[10%] transition-[color,translate] duration-300"
                    // parted from the start, so six plates read at once; the scroll opens them further, and the part in
                    // focus lifts a little and is drawn in ink
                    style={{
                      transform: `translateZ(calc((${fromTop} - 2.5) * (34px + var(--p) * 40px)))`,
                      translate: i === active ? "0 0 18px" : "0 0 0",
                      // only the engraving dims, never the plate or its materials: blued screws and jewels stay solid
                      color: i === active ? "var(--ink)" : "color-mix(in oklch, var(--ink) 58%, transparent)",
                    }}
                  >
                    {plates[i]}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
