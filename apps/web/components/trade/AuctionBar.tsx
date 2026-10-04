"use client";

import { BatchRing } from "@/components/app/BatchRing";
import { nextAuction, type MarketState } from "@/lib/demo/engine";
import { BEAT_MS } from "@/lib/motion/tokens";
import { useMarketMoment } from "@/lib/time/useMarketMoment";

// a count and its noun never part at a line end
const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`.replace(/ /g, " ");
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const nyTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export interface Indicative {
  /** the tick the batch now forming would clear at */
  tick: number;
  /** what would trade there */
  volume: number;
  /** demand minus supply at that tick: who is left over */
  imbalance: number;
}

/**
 * The state of the auction, on every screen: when the next one runs, where it would clear now and how much would
 * trade, and what the last one did. In session there is an auction every block. While the reference market is
 * closed there is one every `discCadence` blocks: the escapement fills block by block, orders gather, and all that
 * gathered clears together at one price; the bar says when that ends and how the reopening cross works.
 */
export function AuctionBar({ m, fmt, indicative }: { m: MarketState; fmt: (tick: number) => string; indicative: Indicative | null }) {
  const regime = m.regime.name;
  const discovery = regime === "DISCOVERY";
  const cadence = discovery ? m.spec.regime.discCadence : 1;
  const left = Math.max(0, nextAuction(m) - m.block);
  const elapsed = Math.max(0, cadence - left);
  const last = m.last;
  const agoBlocks = last ? Math.max(0, m.block - last.block) : null;
  const ago =
    agoBlocks === null
      ? ""
      : agoBlocks <= 1
        ? "just now"
        : `${((agoBlocks * BEAT_MS) / 1000).toFixed(agoBlocks * BEAT_MS < 10_000 ? 1 : 0)} s ago`;
  const unit = m.spec.ticker;
  const stock = m.spec.kind === "equity" || m.spec.kind === "etf" || m.spec.kind === "gold";
  const moment = useMarketMoment();
  // a stock's discovery ends when pre-market opens: the first auction after it is the reopening cross
  const span = moment ? `${Math.floor(moment.minutesToChange / 60)} h ${moment.minutesToChange % 60} min` : "";
  const reopens = discovery && stock && moment ? `in ${moment.minutesToChange < 60 ? `${moment.minutesToChange} min` : span}, at ${nyTime.format(moment.nextChange)} ET` : null;
  // the vault's quote: its best bid and ask in the auction now forming, on the same strip as the cross
  const vaultBid = m.vault.reduce((b, o) => (o.side === "buy" && o.qty > 0 && (b === null || o.tick > b) ? o.tick : b), null as number | null);
  const vaultAsk = m.vault.reduce((a, o) => (o.side === "sell" && o.qty > 0 && (a === null || o.tick < a) ? o.tick : a), null as number | null);
  const closedWho = stock ? "Wall Street is closed" : m.spec.kind === "fx" ? "The currency market is closed" : "Its reference is closed";

  // the vault's quote and the last trade: in the strip on wide screens, behind "Details" on a phone
  const details = (
    <>
      {vaultBid !== null && vaultAsk !== null ? (
        <p className="figures text-sm text-ink-2">
          Vault <span className="text-ink">{fmt(vaultBid)}</span> × <span className="text-ink">{fmt(vaultAsk)}</span>
        </p>
      ) : null}
      <p className="figures text-sm text-ink-2">
        {last ? (
          <>
            Last trade <span className="text-ink">{fmt(last.tick)}</span> · {qty(last.volume)} {unit} · {ago}
          </>
        ) : (
          "No trades yet"
        )}
      </p>
    </>
  );

  return (
    <section aria-label="Auctions" className="mt-5 rounded-[var(--radius-xl)] bg-raised px-5 py-3.5 shadow-panel">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="flex items-center gap-3">
          {discovery ? (
            // the escapement: one step per block, the auction on the last
            <span className="flex items-end gap-[3px]" aria-hidden>
              {Array.from({ length: cadence }, (_, i) => (
                <span
                  key={i}
                  className={`w-[5px] rounded-[1px] transition-colors duration-150 ${i === cadence - 1 ? "h-[18px]" : "h-3.5"} ${i === elapsed - 1 ? "bg-accent" : i < elapsed ? "bg-ink/70" : "bg-ink/[0.12]"}`}
                />
              ))}
            </span>
          ) : (
            <BatchRing size={18} block={regime === "HALTED" ? null : m.block} />
          )}
          <p className="text-sm font-medium text-ink" aria-live="off">
            {regime === "HALTED" ? (
              "Auctions paused while the market is halted"
            ) : discovery ? (
              <>
                Next auction in <span className="tnum">{((Math.max(1, left) * BEAT_MS) / 1000).toFixed(1)} s</span>
                <span className="figures font-normal text-ink-2"> · {plural(m.forming, "new order")}</span>
              </>
            ) : (
              "An auction every block, about 0.3 s"
            )}
          </p>
        </div>
        {/* the batch now forming, cleared as it stands */}
        <p className="figures text-sm text-ink-2" aria-live="off">
          {indicative ? (
            <>
              Clears now <span className="font-medium text-ink">{fmt(indicative.tick)}</span> · {qty(indicative.volume)} {unit}
              <span className="hidden sm:inline">
                {Math.abs(indicative.imbalance) >= 0.01
                  ? ` · ${indicative.imbalance > 0 ? "buyers" : "sellers"} left with ${qty(Math.abs(indicative.imbalance))} ${unit}`
                  : " · balanced"}
              </span>
            </>
          ) : (
            "No cross yet: buyers and sellers don't meet inside the band"
          )}
        </p>
        <div className="hidden sm:contents">{details}</div>
      </div>
      {/* phones read two lines (when, and where it clears now); the rest waits behind one disclosure */}
      <details className="group mt-2 sm:hidden">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
          Details
          <span aria-hidden className="transition-transform duration-150 group-open:rotate-90">›</span>
        </summary>
        <div className="space-y-1.5 pb-1">
          {details}
          {discovery ? (
            <p className="text-xs leading-relaxed text-ink-3">
              {closedWho}: a call auction every {(cadence * BEAT_MS) / 1000} s, around the last close.
              {reopens ? ` Reopening cross ${reopens}.` : ""}
            </p>
          ) : null}
        </div>
      </details>
      {discovery ? (
        // one idea a sentence: why, how often, around what, and when it ends
        <p className="mt-2 hidden text-xs leading-relaxed text-ink-3 sm:block">
          {closedWho}. {unit} trades in a call auction every {cadence} blocks, about {(cadence * BEAT_MS) / 1000} s. Its
          band is centred on the last close, {fmt(m.refTick)}, and widens the longer the market stays closed.
          {reopens ? (
            <>
              {" "}
              Pre-market opens {reopens}. Its first auction is a reopening cross, with a ±
              {(m.spec.regime.reopenBandBps / 100).toFixed(2)}% band.
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
