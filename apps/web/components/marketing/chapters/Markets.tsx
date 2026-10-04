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
      className="group flex items-center gap-4 border-t border-line py-4 transition-colors duration-150 hover-fine:bg-ink/[0.02]"
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
    <section aria-labelledby="markets-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="max-w-3xl">
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
      {/* hairline rows, two columns: the structure is in the rules, not in ten raised tiles */}
      <div className="mt-14 grid grid-cols-1 gap-x-12 border-b border-line md:grid-cols-2">
        {MARKETS.map((m, i) => (
          <Card key={m.ticker} m={m} regime={regimes[i] ?? null} />
        ))}
      </div>
      <p className="mt-4 max-w-3xl text-sm text-ink-3">
        Stocks, funds and gold clear against a reference the venue signs after each batch, checked against Chainlink
        (in simulation today); the pound and MON clear against Chainlink price feeds.
      </p>
    </section>
  );
}
