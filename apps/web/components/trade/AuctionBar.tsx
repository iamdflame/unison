"use client";

import { BatchRing } from "@/components/app/BatchRing";
import { nextAuction, type MarketState } from "@/lib/demo/engine";
import { BEAT_MS } from "@/lib/motion/tokens";

const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;

/**
 * When the next auction runs, what is waiting for it, and what the last one did. In session there is an auction every
 * block. While the reference market is closed there is one every `discCadence` blocks: the escapement fills block by
 * block, orders gather, and everything that gathered clears together at one price.
 */
export function AuctionBar({ m, fmt }: { m: MarketState; fmt: (tick: number) => string }) {
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
  const unitName = m.spec.ticker;

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
                  className={`w-[5px] rounded-[1px] transition-colors duration-150 ${i === cadence - 1 ? "h-[18px]" : "h-3.5"} ${i < elapsed ? "bg-accent" : "bg-ink/[0.12]"}`}
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
              </>
            ) : (
              "An auction every block, about 0.3 s"
            )}
          </p>
        </div>
        {discovery ? (
          <p className="figures text-sm text-ink-2">{plural(m.forming, "new order")} since the last one</p>
        ) : null}
        <p className="figures text-sm text-ink-2">
          {last ? (
            <>
              Last trade <span className="text-ink">{fmt(last.tick)}</span> ·{" "}
              {last.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })} {unitName} · {ago}
            </>
          ) : (
            "No trades yet"
          )}
        </p>
      </div>
      {discovery ? (
        <p className="mt-2 text-xs leading-relaxed text-ink-3 sm:hidden">
          Its market is closed: a call auction every {(cadence * BEAT_MS) / 1000} s, in a band around the last close.
        </p>
      ) : null}
      {discovery ? (
        <p className="mt-2 hidden text-xs leading-relaxed text-ink-3 sm:block">
          Its market is closed, so {unitName} trades in a call auction every {cadence} blocks, about{" "}
          {(cadence * BEAT_MS) / 1000} s. The band is centred on the last close, {fmt(m.refTick)}, and widens the longer
          the market stays closed. Prices here come from these auctions, not from the closed market.
        </p>
      ) : null}
    </section>
  );
}
