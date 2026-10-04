"use client";

import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import { Emblem, type EmblemHandle } from "@/components/brand/Emblem";
import { useInView } from "@/components/motion/useInView";
import { facts, shipped } from "@/lib/content/facts";
import { site } from "@/lib/content/site";

/**
 * The sniper benchmark as an instrument (chapter 2's figure, the only part of the chapter that runs on the client):
 * what a latency sniper takes per day from each kind of venue, on one simulated path, to a linear scale; under each,
 * what its liquidity keeps and what a taker pays. Unison's column is a hairline at zero with the ball resting on it.
 */
const row = (key: string) => facts.fairnessTable.find((r) => r.key === key)!;
// every venue with both readings: what liquidity keeps and what a taker pays, so no column hides its trade-off
const VENUES = [
  {
    name: "Constant-product AMM",
    note: "fee 30 bp",
    value: facts.sniper.xyk,
    lp: row("xy=k AMM").lp,
    taker: row("xy=k AMM").noiseBps,
  },
  {
    name: "Order book",
    note: "makers ±2 bp",
    value: facts.sniper.clob,
    lp: shipped.clob.lp,
    taker: shipped.clob.noiseBps,
  },
  {
    name: "Oracle AMM",
    note: "push oracle",
    value: facts.sniper.pushOracleAmm,
    lp: row("Push-oracle AMM").lp,
    taker: row("Push-oracle AMM").noiseBps,
  },
  {
    name: "Unison",
    note: "in session, vault ±10 bp",
    value: facts.sniper.unison,
    us: true,
    lp: shipped.vault.lp,
    taker: shipped.vault.noiseBps,
  },
] as const;

/** The share of the plot the largest bar fills; the rest is headroom for its figure. */
const PLOT = 0.78;

export function FrontRunFigure() {
  const ref = useRef<HTMLDivElement>(null);
  const mark = useRef<EmblemHandle>(null);
  const shown = useInView(ref, { threshold: 0.35 });
  const [revealed, setRevealed] = useState(0);
  const max = Math.max(...VENUES.map((v) => v.value));

  // Columns engrave left to right, Unison last; its zero lands with a strike of the mark.
  useEffect(() => {
    if (!shown) return;
    const ids = VENUES.map((_, i) => setTimeout(() => setRevealed(i + 1), 120 + i * 160));
    ids.push(setTimeout(() => mark.current?.strike(1), 120 + VENUES.length * 160 + 300));
    return () => ids.forEach(clearTimeout);
  }, [shown]);

  return (
    <figure ref={ref} className="lg:col-span-7">
      <p className="text-sm font-medium text-ink-2">Taken by snipers, per day (simulation)</p>
      {/* To scale: every bar is value ÷ largest of one plot height; the figures sit above their bars, outside it */}
      <div className="mt-6 grid grid-cols-4 gap-3 sm:gap-6">
        {VENUES.map((v, i) => {
          const h = (v.value / max) * PLOT;
          return (
            <div key={v.name}>
              <div className="relative" style={{ height: "clamp(230px, 30vw, 360px)" }}>
                <div
                  className="numerals absolute left-0 leading-none text-ink"
                  style={{ fontSize: "clamp(1.25rem, 2.6vw, 2.5rem)", bottom: `calc(${h * 100}% + 12px)` }}
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
                  <div className="absolute inset-x-0 bottom-0 h-px bg-ink">
                    <span className="absolute -top-[14px] left-1/2 -translate-x-1/2 text-ink">
                      <Emblem ref={mark} size={28} jewel title="Unison" />
                    </span>
                  </div>
                ) : (
                  <div
                    // engraved, not printed: a hatched column under a solid rule
                    className="absolute inset-x-0 bottom-0 origin-bottom border-t-2 border-current text-ink [background:repeating-linear-gradient(135deg,color-mix(in_oklch,currentColor_55%,transparent)_0_1px,transparent_1px_6px)] transition-[scale] duration-[900ms] ease-[cubic-bezier(0.23,1,0.32,1)] night:text-champagne"
                    style={{ height: `${h * 100}%`, scale: `1 ${revealed > i ? 1 : 0.02}` }}
                  />
                )}
              </div>
              <div className="mt-4 border-t border-line-strong pt-3">
                <p className="text-sm font-medium text-ink">{v.name}</p>
                <p className="text-xs text-ink-3">{v.note}</p>
                <dl className="mt-3 space-y-1.5 text-xs text-ink-3">
                  <div>
                    <dt>Liquidity keeps</dt>
                    <dd className="figures mt-0.5 text-sm font-medium text-ink">
                      ${v.lp.toLocaleString("en-US")} a day
                    </dd>
                  </div>
                  <div>
                    <dt>A taker pays</dt>
                    <dd className="figures mt-0.5 text-sm font-medium text-ink">{v.taker.toFixed(1)} bp</dd>
                  </div>
                </dl>
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-8 max-w-xl text-xs leading-relaxed text-ink-3">
        Sniper profit per day on one simulated path: {facts.benchmark.blocks.toLocaleString("en-US")} Monad blocks (
        {facts.benchmark.hours} h), {facts.benchmark.sigmaPct}% volatility with news jumps. Unison runs the real
        clearing engine.{" "}
        <a
          className="underline decoration-line-strong underline-offset-4 hover-fine:text-ink"
          href={`${site.repo}/blob/main/docs/evidence/fairness.md`}
        >
          Method and assumptions
        </a>
      </figcaption>
    </figure>
  );
}
