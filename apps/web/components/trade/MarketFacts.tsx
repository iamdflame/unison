"use client";

import type { MarketState } from "@/lib/demo/engine";
import { facts } from "@/lib/content/facts";
import { site } from "@/lib/content/site";
import { BEAT_MS } from "@/lib/motion/tokens";

const pct = (bps: number) => `±${(bps / 100).toFixed(2)}%`;

/**
 * What a trader needs before size, on the terminal itself: what the instrument is, what this network is, and the
 * rules every auction keeps. Hairline rows, the venue's own parameters, nothing a reader has to look up elsewhere.
 */
export function MarketFacts({ m }: { m: MarketState }) {
  const s = m.spec;
  const stock = s.kind === "equity" || s.kind === "etf" || s.kind === "gold";
  const what =
    stock
      ? `${s.name} ${s.kind === "equity" ? "stock" : "fund shares"}, tokenized by Anchored on Monad, quoted in AUSD.`
      : s.kind === "fx"
        ? `${s.name}, as Mento's GBPm on Monad, quoted in AUSD.`
        : `${s.name}'s native token, wrapped, quoted in AUSD.`;
  const rows: [string, string][] = [
    ["Instrument", what],
    ["This network", site.disclosure],
    [
      "Reference",
      stock
        ? "Published after each batch closes, so no order can be placed against it. While the primary market is closed it holds at the last close."
        : "Published after each batch closes, so no order can be placed against it.",
    ],
    [
      "Auctions",
      `One every block, about ${BEAT_MS} ms, while the reference trades; one every ${s.regime.discCadence} blocks, about ${(s.regime.discCadence * BEAT_MS) / 1000} s, while it is closed. Halts follow the primary market.`,
    ],
    [
      "Band",
      `${pct(s.bandBps)} in session, ${pct(s.regime.extBandBps)} in extended hours, ${pct(s.regime.reopenBandBps)} for the reopening cross; while closed, from ${pct(s.regime.discFloorBps)} widening to ${pct(s.regime.discCapBps)}.`,
    ],
    [
      "Allocation",
      "Every fill in a batch is at its one price. Orders better than it fill in full; orders at it share what is left, pro rata.",
    ],
    [
      "Fees",
      `${s.feeBps} bp on each fill, buyers and sellers alike. A resting buy holds ${s.maxFeeBps} bp, the most the fee can ever be set to; what isn't paid comes back.`,
    ],
    [
      "Checks",
      `The contracts are not yet externally audited. An outside check of the reference (Chainlink CRE, every ${facts.cre.auditEverySec} s, halting the market past ${facts.cre.haltAboveBps} bp) runs in simulation today.`,
    ],
  ];
  return (
    <section aria-labelledby="facts-title" className="rounded-[var(--radius-xl)] bg-raised shadow-panel">
      <h2 id="facts-title" className="px-5 pt-4 pb-3 text-[15px] font-semibold text-ink">
        About {s.ticker} on Unison
      </h2>
      <dl className="divide-y divide-line border-t border-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
            <dt className="text-ink-3">{k}</dt>
            <dd className="leading-relaxed text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
