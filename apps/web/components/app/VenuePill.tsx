"use client";

import { useVenue } from "@/lib/venue";

/** Says plainly where you are: a live network (and which), or the simulation. */
export default function VenuePill() {
  const v = useVenue();
  if (!v.ready) return null;
  return v.mode === "live" && v.net ? (
    <span className="hidden items-center gap-1.5 rounded-full bg-buy-soft px-2.5 py-1 text-xs font-semibold text-buy xl:inline-flex">
      <span aria-hidden className="size-1.5 rounded-full bg-current" /> {v.net.network === "mainnet" ? "Monad" : v.net.network === "testnet" ? "Monad testnet" : "Local devnet"}
    </span>
  ) : (
    <span className="hidden rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-ink-3 xl:inline">Simulation</span>
  );
}
