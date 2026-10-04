"use client";

import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/motion/useInView";

/**
 * Chapter 7: built for agents, bounded by people. A real MCP session types itself out (the tool names and fields
 * are the ones services/mcp serves) beside the session key that bounds it.
 */
const SCRIPT: { kind: "in" | "out"; text: string }[] = [
  { kind: "in", text: 'unison.market({ symbol: "aNVDA/AUSD" })' },
  { kind: "out", text: "reference $181.20 · discovery band ±4.49% · fee 3 bp" },
  { kind: "in", text: 'unison.place_order({ symbol: "aNVDA/AUSD", side: "buy", price: "181.30", qty: "2" })' },
  { kind: "out", text: "signed with session key 0x8c3e…41d2 · inside its limits · relayed, no gas" },
  { kind: "in", text: 'unison.order_status({ id: "5c1e…" })' },
  { kind: "out", text: "filled 2.00 at $181.23 · same price as everyone in batch 110,330,351" },
];

/** Where each line starts in the typed stream. */
const STARTS = SCRIPT.map((_, i) => SCRIPT.slice(0, i).reduce((n, l) => n + l.text.length, 0));

export function Agents() {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useInView(ref, { threshold: 0.4 });
  const [chars, setChars] = useState(0);
  const total = SCRIPT.reduce((n, l) => n + l.text.length, 0);

  useEffect(() => {
    if (!shown) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = setTimeout(() => setChars(total), 0);
      return () => clearTimeout(id);
    }
    const id = setInterval(() => setChars((c) => (c >= total ? c : c + 3)), 24);
    return () => clearInterval(id);
  }, [shown, total]);

  return (
    <section aria-labelledby="agents-title" className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:px-12 lg:py-32">
      <div ref={ref} className="grid grid-cols-1 items-center gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="agents-title" className="text-display-l text-ink">
            Built for agents.
            <br />
            Bounded by people.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            Speed buys nothing here, so software competes on judgement instead of latency. Give an agent a session key
            with the limits you choose: markets, size, notional and expiry. It can trade inside them. It can never
            withdraw.
          </p>
          <p className="mt-6 text-sm text-ink-3">Works with any MCP client, the TypeScript SDK, or plain signed messages.</p>
        </div>

        <div className="relative lg:col-span-7">
          {/* The terminal is a night instrument in either light. */}
          <div data-theme="night" className="rounded-[var(--radius-2xl)] bg-[oklch(0.15_0.007_265)] p-1.5 text-ink shadow-float">
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="ml-3 text-xs text-ink-3">agent · unison mcp</span>
            </div>
            <pre
              role="img"
              className="min-h-[300px] overflow-x-auto rounded-[calc(var(--radius-2xl)-6px)] bg-[oklch(0.12_0.006_265)] p-6 font-mono text-[13px] leading-7"
              aria-label="An agent reads the market, places an order with its session key, and gets filled at the batch price."
            >
              {SCRIPT.map((l, i) => {
                const take = Math.max(0, Math.min(l.text.length, chars - STARTS[i]!));
                if (take === 0 && i > 0) return null;
                return (
                  <div key={i} className={l.kind === "in" ? "text-ink" : "text-accent"}>
                    <span aria-hidden className="select-none text-ink-3">{l.kind === "in" ? "› " : "  "}</span>
                    {l.text.slice(0, take)}
                    {take < l.text.length && take > 0 ? <span aria-hidden className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-ink/70" /> : null}
                  </div>
                );
              })}
            </pre>
          </div>

          <div className="relative -mt-10 ml-auto w-[min(100%,360px)] rounded-[var(--radius-xl)] bg-raised/95 p-5 shadow-float backdrop-blur-xl sm:mr-8 lg:-mt-16 [@media(prefers-reduced-transparency:reduce)]:bg-raised">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <KeyRound size={16} strokeWidth={1.5} aria-hidden /> Session key
              <span className="ml-auto text-xs font-normal text-ink-2">expires in 59 min</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-ink-3">Markets</dt>
              <dd className="text-right text-ink">aNVDA, aSPY</dd>
              <dt className="text-ink-3">Size per order</dt>
              <dd className="figures text-right text-ink">5 shares</dd>
              <dt className="text-ink-3">Notional</dt>
              <dd className="figures text-right text-ink">$2,000</dd>
              <dt className="text-ink-3">Withdraw</dt>
              <dd className="text-right font-semibold text-ink">Never</dd>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
