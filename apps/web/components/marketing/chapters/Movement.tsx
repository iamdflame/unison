"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef, useState } from "react";
import { facts } from "@/lib/content/facts";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Chapter 5: the movement. Six engraved plates (the system's layers) stacked like a watch movement, separating as
 * you scroll the way Apple shows an exploded device. The copy follows the plate in focus. Reduced motion: the
 * movement is shown already exploded, with every layer described.
 */
const PLATES = [
  { name: "Gateway", line: "Orders signed with a passkey, a wallet, or an agent key with limits. Relayed without gas." },
  { name: "Book", line: `Every price level of a batch, aggregated in page-aligned storage, so an order costs about $${facts.gas.orderUsd}.` },
  { name: "Clearing", line: "One uniform price: the most volume, then the least imbalance, then the closest to the reference." },
  { name: "References", line: "Signed after the batch closes, bound to it, and audited by Chainlink every 30 seconds." },
  { name: "Vault", line: "Liquidity that quotes around the reference and has nothing to lose to snipers." },
  { name: "Compliance", line: "Volume caps, eligibility and halts from the SEC's tokenized-venue rules, written as code." },
] as const;

export function Movement() {
  const scope = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useGSAP(
    () => {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const stage = scope.current?.querySelector<HTMLElement>("[data-stage]");
      if (!stage) return;
      if (reduce) {
        stage.style.setProperty("--p", "1");
        return;
      }
      ScrollTrigger.create({
        trigger: scope.current,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.6,
        onUpdate: (self) => {
          stage.style.setProperty("--p", self.progress.toFixed(4));
          setActive(Math.min(PLATES.length - 1, Math.floor(self.progress * PLATES.length * 0.999)));
        },
      });
    },
    { scope },
  );

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
                    i === active ? "border-ink opacity-100" : "border-line opacity-45 motion-reduce:opacity-100"
                  }`}
                >
                  <p className="text-[15px] font-semibold text-ink">{p.name}</p>
                  <p className={`mt-1 max-w-md text-sm leading-relaxed text-ink-2 ${i === active ? "" : "lg:hidden motion-reduce:block"}`}>{p.line}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-16 lg:col-span-7 lg:mt-0">
          <div data-stage className="relative mx-auto aspect-square w-full max-w-[640px] [--p:0] [perspective:1800px]" aria-hidden>
            <div className="absolute inset-0 [transform-style:preserve-3d] [transform:rotateX(58deg)_rotateZ(-38deg)]">
              {PLATES.map((p, i) => {
                const fromTop = PLATES.length - 1 - i;
                return (
                  <div
                    key={p.name}
                    className="absolute inset-[14%] rounded-[34px] border border-line-strong shadow-lg transition-opacity duration-300"
                    style={{
                      transform: `translateZ(calc(${fromTop} * (14px + var(--p) * 96px)))`,
                      background:
                        "radial-gradient(120% 120% at 30% 20%, var(--bg-raised), var(--bg-sunken)), repeating-radial-gradient(circle at 50% 50%, transparent 0 6px, var(--engrave) 6px 7px)",
                      backgroundBlendMode: "normal",
                      opacity: i === active ? 1 : 0.92,
                    }}
                  >
                    <div
                      className="absolute inset-0 rounded-[34px] opacity-60"
                      style={{ background: "repeating-radial-gradient(circle at 50% 50%, transparent 0 7px, var(--engrave) 7px 8px)" }}
                    />
                    <span className="dial-label absolute bottom-6 left-7 text-ink-2" style={{ fontSize: 13 }}>
                      {p.name}
                    </span>
                    <span
                      className="absolute top-6 right-7 size-3 rounded-full transition-colors duration-300"
                      style={{ background: i === active ? "var(--ball-3)" : "var(--line-strong)" }}
                    />
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
