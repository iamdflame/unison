"use client";

import type { MarketState } from "@/lib/demo/engine";
import { causalWait, facts } from "@/lib/content/facts";
import { REFERENCE_RULES } from "@/lib/content/markets";
import { site } from "@/lib/content/site";
import { BEAT_MS } from "@/lib/motion/tokens";
import { startTour } from "@/lib/ui/tour";
import { onMainnet, useVenue } from "@/lib/venue";

const pct = (bps: number) => `±${(bps / 100).toFixed(2)}%`;

/**
 * What a trader needs before size, on the terminal itself: what the instrument is, what this network is, and the
 * rules every auction keeps. Hairline rows, the venue's own parameters, nothing a reader has to look up elsewhere.
 */
export function MarketFacts({ m }: { m: MarketState }) {
  const s = m.spec;
  const stock = s.kind === "equity" || s.kind === "etf" || s.kind === "gold";
  // a live network names its own price source (mainnet's equities read Chainlink, not the venue's relay)
  const v = useVenue();
  const reference = (v.mode === "live" ? v.net?.deployment.markets[s.symbol]?.reference : undefined) ?? s.reference;
  // SPEC §7.4: each auction prices at the first Chainlink observation after its orders were sealed
  const causal = reference === "chainlink-causal";
  const wait = causal ? causalWait(s.symbol) : null;
  const feed = stock ? `Chainlink's tokenized-equity feed for ${s.underlying}` : `Chainlink's ${s.ticker === "WMON" ? "MON" : s.ticker}/USD feed`;
  const what =
    stock
      ? `${s.name} ${s.kind === "equity" ? "stock" : "fund shares"}, tokenized by Anchored on Monad, quoted in AUSD.`
      : s.kind === "fx"
        ? `${s.name}, as Mento's GBPm on Monad, quoted in AUSD.`
        : `${s.name}'s native token, wrapped, quoted in AUSD.`;
  const rows: [string, string][] = [
    ["Instrument", what],
    ["This network", onMainnet(v) ? site.mainnetDisclosure : v.mode === "live" ? site.testnetDisclosure : site.simulationDisclosure],
    [
      "Reference",
      causal
        ? `${feed} on Monad, over its AUSD/USD feed. Each auction prices at the first price Chainlink observes after its orders are in: the observation time is inside the report Chainlink's oracles sign, and the contract checks it against the feed's own history. That price did not exist when you ordered, and no trader, keeper or Unison key can choose another.${stock ? " The feed runs 24/5 (Sunday 8 pm to Friday 8 pm New York time)." : ""}`
        : reference === "chainlink" && stock
        ? `Chainlink's tokenized-equity feed for ${s.underlying} on Monad, over its AUSD/USD feed, read as each batch clears. No Unison key signs it. The feed runs 24/5 (Sunday 8 pm to Friday 8 pm New York time); outside those hours, or if it goes stale, the market finds its own price in call auctions around the last close.`
        : reference === "operator"
        ? `Signed by the venue's relay after each batch closes (${REFERENCE_RULES.quorum === 1 ? "one signing key today" : `${REFERENCE_RULES.quorum} signers`}), from market data (Alpaca in production, simulated here), and refused if older than ${REFERENCE_RULES.maxAgeSec} s. An outside check, Chainlink CRE comparing it with Alpaca IEX and Finnhub, halts the market past ${facts.cre.haltAboveBps} bp; it runs in simulation today. While the primary market is closed the reference holds at the last close.`
        : "Chainlink price feeds, read after each batch closes, so no order can be placed against them.",
    ],
    [
      "While closed",
      causal
        ? stock
          ? "Prices are found in call auctions among traders, not taken from the closed market. The vault stops quoting until the feed reopens, so nobody trades against a stale price."
          : "Its feed never closes. If it ever went silent for over an hour, the market would run call auctions among traders and the vault would stop quoting."
        : stock
        ? `Prices are found in call auctions, not taken from the closed market. The vault quotes ${s.vault?.closedMult ?? 4} times wider and trades at most ${(s.vault?.maxAuctionBps ?? 1000) / 100}% of its value an auction. A resting order can be filled by someone who knows more, as on any market overnight; choose "Next auction only" not to rest.`
        : "It trades every block; its reference never closes.",
    ],
    [
      "Auctions",
      causal
        ? `One at each Chainlink observation that finds orders waiting: typically ${wait?.p50 ?? "under a minute"} after you order${wait ? ` ${wait.when}` : ""}${wait?.offHours ? `, about ${wait.offHours} otherwise` : ""}. Every order joins one auction; what doesn't fill comes back, and until its auction runs an order is sealed.`
        : `One every block, about ${BEAT_MS} ms, while the reference trades; one every ${s.regime.discCadence} blocks, about ${(s.regime.discCadence * BEAT_MS) / 1000} s, while it is closed. Halts follow the primary market.`,
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
      causal
        ? `${s.feeBps} bp on each fill, buyers and sellers alike. A buy holds ${s.maxFeeBps} bp until its auction, the most the fee can ever be set to; what isn't paid comes back.`
        : `${s.feeBps} bp on each fill, buyers and sellers alike. A resting buy holds ${s.maxFeeBps} bp, the most the fee can ever be set to; what isn't paid comes back.`,
    ],
    [
      "Checks",
      causal
        ? "The contracts are not yet externally audited. The price is Chainlink's own observation, proven on-chain to be the first after the auction's orders; Unison holds no key that can sign it or pick a different one."
        : reference === "chainlink"
        ? "The contracts are not yet externally audited. The reference is Chainlink's own feed, read on-chain as each batch clears; Unison runs no reference of its own for this market."
        : `The contracts are not yet externally audited. An outside check of the reference (Chainlink CRE, every ${facts.cre.auditEverySec} s, halting the market past ${facts.cre.haltAboveBps} bp) runs in simulation today.`,
    ],
  ];
  return (
    <section aria-labelledby="facts-title" className="rounded-[var(--radius-xl)] bg-raised shadow-panel">
      <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
        <h2 id="facts-title" className="text-[15px] font-semibold text-ink">
          About {s.ticker} on Unison
        </h2>
        {/* the guided tour, replayed: the one a first visit is offered */}
        <button type="button" onClick={startTour} className="press tap rounded-[var(--radius-xs)] text-sm font-medium text-ink-2 hover-fine:text-ink">
          Take the tour
        </button>
      </div>
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
