"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BandDial } from "@/components/app/BandDial";
import { MARKETS, type MarketSpec } from "@/lib/content/markets";
import { bandLabel, REGIME_LABEL, regimeNow, type RegimeNow } from "@/lib/unison/regimeNow";

/**
 * Chapter 9: the markets. Each is a small dial: the band it would clear under right now (from the bit-exact engine
 * port and the market's mainnet parameters) drawn as an arc around a reference at 12 o'clock.
 */
function Card({ m, regime }: { m: MarketSpec; regime: RegimeNow | null }) {
  return (
    <Link
      href={`/trade/${m.ticker}`}
      className="group press flex items-center gap-4 rounded-[var(--radius-xl)] bg-raised p-4 shadow-sm transition-shadow duration-200 hover-fine:shadow-md"
    >
      <BandDial bandBps={regime ? regime.bandBps : null} regime={regime?.name} />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-ink">
          {m.ticker}
          <span className="ml-2 text-sm font-normal text-ink-3">{m.name}</span>
        </p>
        <p className="mt-1 text-sm text-ink-2">
          {regime ? `${REGIME_LABEL[regime.name]} · ${bandLabel(regime.bandBps)}` : " "}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          {m.reference === "operator" ? "Signed reference, Chainlink-audited" : "Chainlink price feed"}
        </p>
      </div>
    </Link>
  );
}

export function Markets() {
  const [regimes, setRegimes] = useState<(RegimeNow | null)[]>(() => MARKETS.map(() => null));
  useEffect(() => {
    const tick = () => setRegimes(MARKETS.map((m) => regimeNow(m, new Date())));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  return (
    <section aria-labelledby="markets-title" className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:px-12 lg:py-32">
      <div className="max-w-2xl">
        <h2 id="markets-title" className="text-display-l text-ink">
          Ten markets.
          <br />
          One rulebook.
        </h2>
        <p className="text-lede mt-6 text-ink-2">
          US stocks and funds tokenized by Anchored, gold, the pound and Monad itself, all quoted in AUSD. Each dial
          shows the band its next auction would use right now.
        </p>
      </div>
      <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2">
        {MARKETS.map((m, i) => (
          <Card key={m.ticker} m={m} regime={regimes[i] ?? null} />
        ))}
      </div>
    </section>
  );
}
