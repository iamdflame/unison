"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/motion/useInView";
import { estimatedBlock } from "@/lib/hero/feed";
import { facts } from "@/lib/content/facts";
import { BEAT_MS } from "@/lib/motion/tokens";

/**
 * Chapter 8: only possible on Monad. Three instruments, no stat row: a strip of blocks advancing one cell per beat
 * (dead-beat), the gas a clear costs against a ghost of the same clear under Ethereum's rules, and what a batch costs.
 */
const CELLS = 60;

export function OnlyOnMonad() {
  const ref = useRef<HTMLDivElement>(null);
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

  const monad = facts.gas.clearMonad / facts.gas.clearEthereumRules;

  return (
    <section aria-labelledby="monad-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div ref={ref} className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="monad-title" className="text-display-l text-ink">
            Made for Monad.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            Sealing orders every 300 milliseconds, and running an auction for every new price, needs a chain that
            keeps that beat and storage priced by the page. Unison lays out its book page by page, so clearing costs {facts.gas.savingPct}% less gas under Monad&apos;s rules
            than the same code under Ethereum&apos;s.
          </p>
        </div>
        <div className="flex flex-col gap-12 lg:col-span-7">
          <figure>
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

          <figure>
            <div className="space-y-3">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink">Clear on Monad</span>
                  <span className="figures text-ink">{facts.gas.clearMonad.toLocaleString("en-US")} gas</span>
                </div>
                <div className="mt-2 h-1.5 rounded-[1px] bg-sunken">
                  <div className="h-full rounded-[1px] bg-ink" style={{ width: `${monad * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink-3">Same clear, Ethereum&apos;s rules</span>
                  <span className="figures text-ink-3">{facts.gas.clearEthereumRules.toLocaleString("en-US")} gas</span>
                </div>
                {/* filled, in a pale ink: the larger figure must never read as nothing */}
                <div className="mt-2 h-1.5 rounded-[1px] bg-ink/25" />
              </div>
            </div>
            <figcaption className="mt-4 text-sm text-ink-3">Measured with the same contracts on both EVMs.</figcaption>
          </figure>

          <figure className="grid grid-cols-2 gap-6 border-t border-line pt-8">
            <div>
              <p className="numerals text-[clamp(2rem,4vw,3.5rem)] leading-none text-ink">
                ${facts.gas.batch200Usd}
              </p>
              <p className="mt-3 text-sm text-ink-3">to clear a 200-order batch</p>
            </div>
            <div>
              <p className="numerals text-[clamp(2rem,4vw,3.5rem)] leading-none text-ink">
                ${facts.gas.orderUsd}
              </p>
              <p className="mt-3 text-sm text-ink-3">to place an order</p>
            </div>
            {/* every figure with its basis */}
            <figcaption className="col-span-2 text-xs leading-relaxed text-ink-3">
              At Monad&apos;s {facts.gas.baseFeeGwei} gwei minimum base fee and MON at ${facts.gas.monUsd}. Blocks measured at
              293–304 ms in October 2026; every 300 ms figure on this site rests on that.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
