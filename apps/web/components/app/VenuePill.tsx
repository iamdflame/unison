"use client";

import { useVenue } from "@/lib/venue";

/** Says plainly where you are: a live network (and which), or the simulation. */
export default function VenuePill() {
  const v = useVenue();
  if (!v.ready) return null;
  // Live: which network, at every width. The simulation is named on the account pill instead ("Paper").
  if (v.mode !== "live" || !v.net) return null;
  const long = v.net.network === "mainnet" ? "Monad" : v.net.network === "testnet" ? "Monad testnet" : "Local devnet";
  const short = v.net.network === "mainnet" ? "Monad" : v.net.network === "testnet" ? "Testnet" : "Devnet";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] bg-buy-soft px-2 py-1 text-xs font-semibold text-buy" title={long}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{long}</span>
    </span>
  );
}
