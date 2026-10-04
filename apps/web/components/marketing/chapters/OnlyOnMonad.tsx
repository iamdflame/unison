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
const CELLS = 24;

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
    <section aria-labelledby="monad-title" className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:px-12 lg:py-32">
      <div ref={ref} className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="monad-title" className="text-display-l text-ink">
            Only possible on Monad.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            A batch every 300 milliseconds needs a chain that keeps that beat, and storage priced by the page. Unison
            lays out its book page by page, so clearing costs {facts.gas.savingPct}% less gas under Monad&apos;s rules
            than the same code under Ethereum&apos;s.
          </p>
        </div>
        <div className="flex flex-col gap-12 lg:col-span-7">
          <figure>
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: CELLS }, (_, i) => {
                const head = block === null ? -1 : block % CELLS;
                const age = head < 0 ? CELLS : (head - i + CELLS) % CELLS;
                return (
                  <div
                    key={i}
                    className={`h-14 flex-1 rounded-[5px] ${age === 0 ? "bg-accent" : age < 10 ? "bg-ink" : "border border-line-strong"}`}
                    style={{ opacity: age === 0 ? 1 : age < 10 ? 0.62 - age * 0.055 : 1 }}
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
                <div className="mt-2 h-3 rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${monad * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink-3">Same clear, Ethereum&apos;s rules</span>
                  <span className="figures text-ink-3">{facts.gas.clearEthereumRules.toLocaleString("en-US")} gas</span>
                </div>
                <div className="mt-2 h-3 rounded-full border border-dashed border-line-strong" />
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
          </figure>
        </div>
      </div>
    </section>
  );
}
