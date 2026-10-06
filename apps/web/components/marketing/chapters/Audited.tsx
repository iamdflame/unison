"use client";

import { Hallmark } from "@/components/ui/Hallmark";
import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/motion/useInView";
import { facts } from "@/lib/content/facts";
import { site } from "@/lib/content/site";
import { BEAT_MS } from "@/lib/motion/tokens";

/**
 * Chapter 4: watched by Chainlink. The sentinel as a stepped instrument (one step per beat, nothing in between): seven
 * independent nodes each price MON from separate exchanges, the network agrees on a median, and the result is compared
 * with the Chainlink observation Unison clears against. Far off and silent: halt. Otherwise: carry on.
 */
const NODES = 7;
const STEPS = NODES + 4; // nodes report, consensus, compare, verdict, rest

export function Audited() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useInView(ref, { threshold: 0.35, once: false });
  // At rest (and with reduced motion) it shows the finished audit, never a network that hasn't reported.
  const [step, setStep] = useState(STEPS - 1);

  useEffect(() => {
    if (!live) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = setTimeout(() => setStep(STEPS - 1), 0);
      return () => clearTimeout(id);
    }
    const first = setTimeout(() => setStep(0), BEAT_MS * 2);
    const id = setInterval(() => setStep((s) => (s + 1) % (STEPS + 6)), BEAT_MS * 2);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [live]);

  const reported = Math.min(step, NODES);
  const consensus = step >= NODES + 1;
  const verdict = step >= NODES + 2;
  const node = (i: number) => {
    const a = (i / NODES) * Math.PI * 2 - Math.PI / 2;
    return [Math.round((260 + 170 * Math.cos(a)) * 100) / 100, Math.round((220 + 170 * Math.sin(a)) * 100) / 100] as const;
  };

  return (
    <section aria-labelledby="audited-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div ref={ref} className="grid grid-cols-1 items-start gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          {/* honest about today: the sentinel reads mainnet from Chainlink's CRE simulator, not yet a live network */}
          <h2 id="audited-title" className="text-display-l text-ink">
            A second opinion, every&nbsp;{facts.sentinel.everySec}&nbsp;seconds.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            Unison&apos;s prices are Chainlink&apos;s own observations. A second Chainlink workflow watches them from
            outside: every {facts.sentinel.everySec} seconds, independent nodes price MON from Coinbase and Kraken and
            agree on a median. If the feed is more than {(facts.sentinel.haltAboveBps / 100).toFixed(2)}% off and has been
            silent for {facts.sentinel.silentSec / 60} minutes, trading halts. A gap alone is not enough: while a new price
            is in flight, the feed trails the market by design.
          </p>
          <p className="mt-6 text-sm text-ink-3">
            It runs in Chainlink&apos;s CRE simulator today, reading Monad mainnet, and moves to a live network once access
            is granted. Halts on the primary market are mirrored within a minute.{" "}
            <a className="underline decoration-line-strong underline-offset-4 hover-fine:text-ink" href={`${site.repo}/tree/main/cre/unison`}>
              The workflows
            </a>
          </p>
        </div>
        <figure className="lg:col-span-7">
          <svg viewBox="0 0 520 440" className="mx-auto h-auto w-full max-w-[620px]" role="img" aria-label="Seven independent nodes price MON, agree on a median, and compare it with Chainlink's latest observation. The feed is within limits.">
            {/* seven independent nodes as the jewels of a ring: each chaton is set, flat and engraved, as its node reports */}
            <circle cx="260" cy="220" r="170" fill="none" stroke="var(--champagne)" strokeWidth="0.8" />
            <circle cx="260" cy="220" r="176" fill="none" stroke="var(--champagne)" strokeWidth="0.5" strokeOpacity="0.6" />
            {Array.from({ length: NODES }, (_, i) => {
              const [x, y] = node(i);
              const on = i < reported;
              return (
                <g key={i}>
                  <line x1={x} y1={y} x2="260" y2="220" stroke={on ? "var(--champagne)" : "var(--line)"} strokeWidth="0.8" />
                  <circle cx={x} cy={y} r="15" fill="var(--bg-raised)" stroke={on ? "var(--ink-3)" : "var(--line-strong)"} strokeWidth="1" />
                  <circle cx={x} cy={y} r="9.5" fill={on ? "var(--champagne)" : "none"} stroke={on ? "none" : "var(--line-strong)"} strokeWidth="0.8" style={{ transition: "fill 300ms ease-out" }} />
                </g>
              );
            })}
            <circle cx="260" cy="220" r="84" fill="none" stroke="var(--champagne)" strokeWidth="0.6" />
            <circle cx="260" cy="220" r="78" fill="var(--bg-raised)" stroke={consensus ? "var(--ink)" : "var(--champagne)"} strokeWidth="1.2" />
            <text x="260" y="198" textAnchor="middle" className="dial-label" fill="var(--ink-3)" style={{ fontSize: 10 }}>
              {consensus ? "CONSENSUS" : "NODES REPORTING"}
            </text>
            <text x="260" y="232" textAnchor="middle" className="numerals" fill="var(--ink)" style={{ fontSize: 30 }}>
              {consensus ? "$0.02888" : `${reported}/${NODES}`}
            </text>
            <text x="260" y="256" textAnchor="middle" className="tnum" fill="var(--ink-3)" style={{ fontSize: 12 }}>
              {verdict ? "Chainlink $0.02886 · 0.07% apart" : consensus ? "Median of medians" : "Coinbase · Kraken"}
            </text>
          </svg>
          <figcaption className="mx-auto mt-4 flex max-w-[620px] items-center gap-3 text-sm">
            {/* the verdict as an engraved mark, in the same small capitals as the hallmark beside it */}
            <span className={`dial-label inline-flex shrink-0 items-center gap-1.5 text-[11px] transition-colors duration-200 ${verdict ? "text-buy" : "text-ink-3"}`}>
              <span aria-hidden className={`size-[5px] rounded-full ${verdict ? "bg-buy" : "bg-ink-3"}`} />
              {verdict ? `Within ${(facts.sentinel.haltAboveBps / 100).toFixed(2)}%` : "Watching"}
            </span>
            <span className="text-ink-3">Past {(facts.sentinel.haltAboveBps / 100).toFixed(2)}% with the feed silent, the market halts.</span>
            <Hallmark className="ml-auto">CRE simulator</Hallmark>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
