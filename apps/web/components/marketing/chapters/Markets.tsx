"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MARKETS, type MarketSpec } from "@/lib/content/markets";
import { bandLabel, REGIME_LABEL, regimeNow, type RegimeNow } from "@/lib/unison/regimeNow";

/**
 * Chapter 9: the markets. Each is a small dial: the band it would clear under right now (from the bit-exact engine
 * port and the market's mainnet parameters) drawn as an arc around a reference at 12 o'clock.
 */
function MiniDial({ regime }: { regime: RegimeNow | null }) {
  const pct = regime ? regime.bandBps / 100 : 1;
  const deg = Math.min(150, pct * 16);
  const a = (deg * Math.PI) / 180;
  const r = 40;
  const x1 = 50 - r * Math.sin(a);
  const y1 = 50 - r * Math.cos(a);
  return (
    <svg viewBox="0 0 100 100" className="size-16 shrink-0" aria-hidden>
      <circle cx="50" cy="50" r="46" fill="none" stroke="var(--line)" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="6" x2="50" y2={i % 3 === 0 ? 12 : 9} stroke="var(--ink-3)" strokeWidth="1" transform={`rotate(${i * 30} 50 50)`} />
      ))}
      <path d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${deg > 90 ? 1 : 0} 1 ${(100 - x1).toFixed(2)},${y1.toFixed(2)}`} fill="none" stroke="var(--champagne)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="50" r="5" fill="var(--ball-3)" />
      <line x1="50" y1="45" x2="50" y2="18" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Card({ m, regime }: { m: MarketSpec; regime: RegimeNow | null }) {
  return (
    <Link
      href={`/trade/${m.ticker}`}
      className="group press flex items-center gap-4 rounded-[var(--radius-xl)] bg-raised p-4 shadow-sm transition-shadow duration-200 hover-fine:shadow-md"
    >
      <MiniDial regime={regime} />
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
