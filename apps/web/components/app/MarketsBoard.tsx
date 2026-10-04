"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { MARKETS, priceFormat, type MarketSpec } from "@/lib/content/markets";
import { shallowEqual } from "@/lib/store/createStore";
import { heroLine } from "@/lib/time/market";
import { useMarketMoment } from "@/lib/time/useMarketMoment";
import { useMarket, useVenue } from "@/lib/venue";
import { Spark, sample } from "@/components/trade/Spark";
import { BandDial } from "./BandDial";
import { bandLabel, REGIME_LABEL } from "@/lib/unison/regimeNow";

const KIND: Record<MarketSpec["kind"], string> = { equity: "Stock", etf: "Fund", gold: "Gold", fx: "Currency", crypto: "Crypto" };

/** Every market on one board: its band dial, recent prints, last uniform price and regime. */
/** The live part of /markets: the session line and the board. The title and the notes are drawn by the server. */
export function MarketsBoard() {
  const moment = useMarketMoment();
  const v = useVenue();
  return (
    <>
      <p className="mt-3 min-h-12 text-ink-2 sm:min-h-6">{moment ? heroLine(moment) : ""}</p>
      <p className="mt-1 min-h-5 text-sm text-ink-3">
        {v.ready && v.mode === "demo" ? "Simulation: every batch clears on the real clearing engine, in your browser." : ""}
      </p>

      <div className="mt-8 overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-panel">
        <div className={`hidden items-center gap-x-5 border-b border-line px-6 py-3 text-xs text-ink-3 md:grid md:grid-cols-[48px_minmax(170px,1fr)_120px_112px_112px_minmax(150px,1fr)_16px]`} aria-hidden>
          <span />
          <span>Market</span>
          <span>Last 180 trades</span>
          <span className="text-right">Last price</span>
          <span className="text-right">Change since close</span>
          <span>Session and band</span>
          <span />
        </div>
        <ul className="divide-y divide-line">
          {MARKETS.map((m) => (
            <li key={m.ticker}>
              <Row spec={m} />
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-sm text-ink-3">
        Change is measured from the last close while a market is closed; a market that is trading shows it against its reference, and says so.
      </p>
    </>
  );
}

function Row({ spec }: { spec: MarketSpec }) {
  const v = useVenue();
  const { value: m, live } = useMarket(
    spec.ticker,
    (s) => ({ last: s.last?.tick ?? null, ref: s.refTick, regime: s.regime.name, band: s.regime.bandBps, prints: s.prints }),
    shallowEqual,
    { book: false },
  );
  const { fmt } = priceFormat(spec);
  const ticks = useMemo(() => sample(m.prints.slice(-180).map((p) => p.tick)), [m.prints]);
  const tick = m.last ?? m.ref;
  const simulated = v.mode === "live" && !live;
  // What differs row to row: how far each market's last trade is from its close (while closed) or its reference.
  const closed = m.regime === "DISCOVERY";
  const move = m.last !== null && m.ref > 0 ? ((m.last - m.ref) / m.ref) * 100 : null;
  const basis = closed ? "since the close" : "vs reference";
  const moveText = move === null ? null : `${move > 0.004 ? "+" : move < -0.004 ? "−" : ""}${Math.abs(move).toFixed(2)}%`;
  const moveLabel = moveText === null ? null : `${moveText} ${basis}`;
  const moveTone = move === null || Math.abs(move) < 0.005 ? "text-ink-2" : move > 0 ? "text-buy" : "text-sell";

  return (
    <Link
      href={`/trade/${spec.ticker}`}
      className="group grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3.5 transition-colors duration-150 outline-none hover-fine:bg-ink/[0.03] focus-visible:bg-ink/[0.04] md:grid-cols-[48px_minmax(170px,1fr)_120px_112px_112px_minmax(150px,1fr)_16px] md:gap-x-5 md:px-6"
      aria-label={`${spec.ticker}, ${spec.name}: ${fmt(tick)}, ${m.regime.toLowerCase()}${moveLabel ? `, ${moveLabel}` : ""}${simulated ? ", simulated" : ""}`}
    >
      <BandDial bandBps={m.band} regime={m.regime} needle={m.last !== null && m.ref > 0 && m.band > 0 ? (((m.last - m.ref) / m.ref) * 10_000) / m.band : 0} className="size-10 md:size-12" />
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {spec.ticker}
          {simulated ? <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-3 hairline">Simulation</span> : null}
        </p>
        <p className="truncate text-[13px] text-ink-3">
          {spec.name} · {KIND[spec.kind]}
        </p>
      </div>
      <Spark ticks={ticks} className="hidden h-8 w-[120px] md:block" />
      <div className="text-right">
        <p className="tnum text-[15px] font-semibold text-ink">{fmt(tick)}</p>
        {/* phones: the change under the price */}
        <p className={`figures text-[13px] md:hidden ${moveTone}`}>{moveText ?? ""}</p>
      </div>
      <div className="hidden text-right md:block">
        <p className={`figures text-[15px] ${moveTone}`}>{moveText ?? "None yet"}</p>
        {/* the header says "since close"; only a market measured otherwise says so */}
        {closed ? null : <p className="text-[11px] text-ink-3">{basis}</p>}
      </div>
      {/* the session as quiet text: on a weekend it is the same on most rows, so it never shouts */}
      <p className="hidden text-[13px] text-ink-2 md:block">
        {REGIME_LABEL[m.regime]} <span className="figures text-ink-3">{bandLabel(m.band)}</span>
      </p>
      <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="hidden text-ink-3 transition-colors group-hover:text-ink md:block" />
    </Link>
  );
}
