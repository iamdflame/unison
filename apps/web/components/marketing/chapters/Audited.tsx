"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/motion/useInView";
import { facts } from "@/lib/content/facts";
import { site } from "@/lib/content/site";
import { BEAT_MS } from "@/lib/motion/tokens";

/**
 * Chapter 4: checked by Chainlink. The audit as a stepped instrument (one step per beat, nothing in between): seven
 * independent nodes each price the stock from separate sources, the network agrees on a median, and the result is
 * compared with the reference Unison clears against. Inside 0.75%: carry on. Outside: halt and slash.
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
    <section aria-labelledby="audited-title" className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:px-12 lg:py-32">
      <div ref={ref} className="grid grid-cols-1 items-center gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="audited-title" className="text-display-l text-ink">
            Checked by Chainlink, every {facts.cre.auditEverySec} seconds.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            An independent Chainlink network re-prices every stock from separate market-data sources and compares the
            result with the reference Unison clears against. If they disagree by more than{" "}
            {(facts.cre.haltAboveBps / 100).toFixed(2)}%, trading halts and the signer&apos;s bond is slashed. Halts on
            the primary market are mirrored within a minute.
          </p>
          <p className="mt-6 text-sm text-ink-3">
            Running in Chainlink&apos;s CRE simulator today; deployed to the live network once access is granted.{" "}
            <a className="underline decoration-line-strong underline-offset-4 hover-fine:text-ink" href={`${site.repo}/tree/main/cre/unison`}>
              The workflows
            </a>
          </p>
        </div>
        <figure className="lg:col-span-7">
          <svg viewBox="0 0 520 440" className="mx-auto h-auto w-full max-w-[620px]" role="img" aria-label="Seven independent nodes price the stock, agree on a median, and compare it with the reference. The deviation is within limits.">
            <circle cx="260" cy="220" r="170" fill="none" stroke="var(--line)" strokeDasharray="2 6" />
            {Array.from({ length: NODES }, (_, i) => {
              const [x, y] = node(i);
              const on = i < reported;
              return (
                <g key={i}>
                  <line x1={x} y1={y} x2="260" y2="220" stroke={on ? "var(--ink-3)" : "var(--line)"} strokeWidth="1" />
                  <circle cx={x} cy={y} r="15" fill="var(--bg-raised)" stroke={on ? "var(--ink)" : "var(--line-strong)"} strokeWidth="1.2" />
                  <circle cx={x} cy={y} r="4.5" fill={on ? "var(--accent)" : "var(--line-strong)"} />
                </g>
              );
            })}
            <circle cx="260" cy="220" r="78" fill="var(--bg-raised)" stroke={consensus ? "var(--ink)" : "var(--line-strong)"} strokeWidth="1.2" />
            <text x="260" y="198" textAnchor="middle" className="dial-label" fill="var(--ink-3)" style={{ fontSize: 10 }}>
              {consensus ? "CONSENSUS" : "NODES REPORTING"}
            </text>
            <text x="260" y="232" textAnchor="middle" className="numerals" fill="var(--ink)" style={{ fontSize: 30 }}>
              {consensus ? "$181.17" : `${reported}/${NODES}`}
            </text>
            <text x="260" y="256" textAnchor="middle" className="tnum" fill="var(--ink-3)" style={{ fontSize: 12 }}>
              {verdict ? "Reference $181.20 · 0.02% apart" : consensus ? "Median of medians" : "Alpaca IEX · Finnhub"}
            </text>
          </svg>
          <figcaption className="mx-auto mt-4 flex max-w-[620px] items-center gap-3 text-sm">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium transition-[opacity,background-color] duration-200 ${
                verdict ? "bg-buy-soft text-buy opacity-100" : "bg-sunken text-ink-3 opacity-70"
              }`}
            >
              <Check size={14} strokeWidth={2} aria-hidden />
              {verdict ? "Within 0.75%: trading continues" : "Auditing"}
            </span>
            <span className="text-ink-3">Outside it: halt the market, slash the signer.</span>
            <span className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-ink-2 hairline">CRE simulator</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
