"use client";

import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import { Emblem, type EmblemHandle } from "@/components/brand/Emblem";
import { useInView } from "@/components/motion/useInView";
import { facts } from "@/lib/content/facts";
import { site } from "@/lib/content/site";

/**
 * Chapter 2: speed buys nothing. The benchmark as an instrument: what a latency sniper takes per day from each
 * kind of venue, on the same simulated price path. Linear scale, so the gap is honest. Unison's column is a
 * hairline at zero with the ball resting on it.
 */
const VENUES = [
  { name: "Constant-product AMM", note: "fee 30 bp", value: facts.sniper.xyk },
  { name: "Order book", note: "makers ±2 bp", value: facts.sniper.clob },
  { name: "Oracle AMM", note: "push oracle", value: facts.sniper.pushOracleAmm },
  { name: "Unison", note: "batch + late reference", value: facts.sniper.unison, us: true },
] as const;

export function FrontRun() {
  const ref = useRef<HTMLDivElement>(null);
  const mark = useRef<EmblemHandle>(null);
  const shown = useInView(ref, { threshold: 0.35 });
  const [revealed, setRevealed] = useState(0);
  const max = VENUES[0].value;

  // Columns engrave left to right, Unison last; its zero lands with a strike of the mark.
  useEffect(() => {
    if (!shown) return;
    const ids = VENUES.map((_, i) => setTimeout(() => setRevealed(i + 1), 120 + i * 160));
    ids.push(setTimeout(() => mark.current?.strike(1), 120 + VENUES.length * 160 + 300));
    return () => ids.forEach(clearTimeout);
  }, [shown]);

  return (
    <section aria-labelledby="front-run-title" className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:px-12 lg:py-32">
      <div className="grid grid-cols-1 gap-x-12 gap-y-14 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="front-run-title" className="text-display-l text-ink">
            Speed buys nothing.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            On most venues, whoever sees the price move first trades against everyone else&apos;s stale quotes. Unison
            prices each batch against a reference published after the batch closes, so there is nothing left to race
            for.
          </p>
          <p className="text-lede mt-6 text-ink-2">
            The same ±{facts.lp.spreadBps} bp quote earns liquidity{" "}
            <span className="text-ink">{facts.lp.multiple}× more</span>: ${facts.lp.unisonVault} a day, against $
            {facts.lp.clobMakers} on an order book after snipers take their cut.
          </p>
        </div>

        <figure ref={ref} className="lg:col-span-7">
          <div className="grid grid-cols-4 items-end gap-3 sm:gap-6" style={{ height: "clamp(260px, 34vw, 420px)" }}>
            {VENUES.map((v, i) => {
              const h = v.value / max;
              return (
                <div key={v.name} className="flex h-full flex-col justify-end">
                  <div
                    className="numerals mb-3 leading-none text-ink"
                    style={{ fontSize: "clamp(1.25rem, 2.6vw, 2.5rem)" }}
                  >
                    <NumberFlow
                      value={revealed > i ? v.value : 0}
                      locales="en-US"
                      format={{ style: "currency", currency: "USD", maximumFractionDigits: 0 }}
                      transformTiming={{ duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                      spinTiming={{ duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                    />
                  </div>
                  {"us" in v && v.us ? (
                    <div className="relative h-px bg-ink">
                      <span className="absolute -top-[14px] left-1/2 -translate-x-1/2 text-ink">
                        <Emblem ref={mark} size={28} jewel title="Unison" />
                      </span>
                    </div>
                  ) : (
                    <div
                      className="origin-bottom rounded-t-[3px] bg-ink/[0.86] transition-[scale] duration-[900ms] ease-[cubic-bezier(0.23,1,0.32,1)] night:bg-champagne/80"
                      style={{ height: `${Math.max(h * 100, 0.6)}%`, scale: `1 ${revealed > i ? 1 : 0.02}` }}
                    />
                  )}
                  <div className="mt-4 border-t border-line-strong pt-3">
                    <p className="text-sm font-medium text-ink">{v.name}</p>
                    <p className="text-xs text-ink-3">{v.note}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <figcaption className="mt-8 max-w-xl text-xs leading-relaxed text-ink-3">
            Sniper profit per day on one simulated path: {facts.benchmark.blocks.toLocaleString("en-US")} Monad blocks
            ({facts.benchmark.hours} h), {facts.benchmark.sigmaPct}% volatility with news jumps. Unison runs the real
            clearing engine.{" "}
            <a className="underline decoration-line-strong underline-offset-4 hover-fine:text-ink" href={`${site.repo}/blob/main/docs/evidence/fairness.md`}>
              Method and assumptions
            </a>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
