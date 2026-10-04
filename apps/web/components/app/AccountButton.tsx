"use client";

import { Fingerprint } from "lucide-react";
import { useAccount } from "@/lib/demo/useMarket";

/** The account pill. In the simulation it shows the paper account's free AUSD. */
export function AccountButton() {
  const quote = useAccount((a) => a.quote);
  return (
    <button
      type="button"
      className="press inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-sm font-semibold text-bg"
      aria-label={`Account: ${quote.toFixed(2)} AUSD available`}
    >
      <Fingerprint size={15} strokeWidth={1.6} aria-hidden />
      <span className="tnum">{quote.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      <span className="text-bg/70">AUSD</span>
    </button>
  );
}
