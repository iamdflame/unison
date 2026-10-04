"use client";

import { useMarket } from "@/lib/venue";
import { BatchRing } from "./BatchRing";
import { RegimeBadge } from "./RegimeBadge";

/** The active market's beat, block and regime. Client-only: it is a clock, so the server never renders it. */
export default function LiveBeat({ ticker }: { ticker: string }) {
  const { value } = useMarket(ticker, (m) => ({ block: m.block, regime: m.regime.name, band: m.regime.bandBps }));
  return (
    <>
      <div className="hidden items-center gap-2 lg:flex" title="One batch per Monad block">
        <BatchRing block={value.block} />
        <span className="tnum text-xs text-ink-3">#{value.block.toLocaleString("en-US")}</span>
      </div>
      <span className="hidden md:inline-flex">
        <RegimeBadge name={value.regime} bandBps={value.band} />
      </span>
    </>
  );
}
