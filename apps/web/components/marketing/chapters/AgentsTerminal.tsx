"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/motion/useInView";
import { Hallmark } from "@/components/ui/Hallmark";

/** A real MCP session, typed out: the tool names and fields are the ones services/mcp serves. */
const SCRIPT: { kind: "in" | "out"; text: string }[] = [
  { kind: "in", text: 'unison.market({ symbol: "aNVDA/AUSD" })' },
  { kind: "out", text: "reference $180.00 · live, band ±1.00% · fee 3 bp" },
  { kind: "in", text: 'unison.place_order({ symbol: "aNVDA/AUSD", side: "buy", price: "180.10", qty: "2" })' },
  { kind: "out", text: "signed with session key 0x8c3e…41d2 · inside its limits · relayed, no gas" },
  { kind: "in", text: 'unison.order_status({ id: "5c1e…" })' },
  { kind: "out", text: "filled 2.00 at $180.03 · same price as everyone in block 110,330,351" },
];

/** Where each line starts in the typed stream. */
const STARTS = SCRIPT.map((_, i) => SCRIPT.slice(0, i).reduce((n, l) => n + l.text.length, 0));
const TOTAL = SCRIPT.reduce((n, l) => n + l.text.length, 0);

/**
 * The terminal is a night instrument in either light: Nocturne's own surfaces (raised for the frame, the page for the
 * well), set into a Porcelain page like an enamel dial into its case. A wrapped line hangs under its first character,
 * clear of the prompt, the way a terminal wraps.
 */
export function AgentsTerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useInView(ref, { threshold: 0.4 });
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (!shown) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = setTimeout(() => setChars(TOTAL), 0);
      return () => clearTimeout(id);
    }
    const id = setInterval(() => setChars((c) => (c >= TOTAL ? c : c + 3)), 24);
    return () => clearInterval(id);
  }, [shown]);

  return (
    <div ref={ref} data-theme="night" className="rounded-[var(--radius-2xl)] bg-raised p-1.5 text-ink shadow-float">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-xs text-ink-3">agent · unison mcp</span>
        <Hallmark>Illustration</Hallmark>
      </div>
      <pre
        role="img"
        className="min-h-[248px] rounded-[calc(var(--radius-2xl)-6px)] bg-bg p-4 font-mono text-[12.5px] leading-6 break-words sm:p-6 sm:text-[13px] sm:leading-7 whitespace-pre-wrap shadow-panel [font-variant-ligatures:none]"
        aria-label="An agent reads the market, places an order with its session key, and gets filled at the batch price."
      >
        {SCRIPT.map((l, i) => {
          const take = Math.max(0, Math.min(l.text.length, chars - STARTS[i]!));
          if (take === 0 && i > 0) return null;
          return (
            <div key={i} className={`pl-[2ch] -indent-[2ch] ${l.kind === "in" ? "text-ink" : "text-ink-2"}`}>
              <span aria-hidden className="select-none text-ink-3">{l.kind === "in" ? "› " : "  "}</span>
              {l.text.slice(0, take)}
              {take < l.text.length && take > 0 ? <span aria-hidden className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 indent-0 bg-ink/70" /> : null}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
