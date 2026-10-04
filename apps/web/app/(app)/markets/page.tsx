import type { Metadata } from "next";
import { MarketsClient } from "@/components/app/screens/MarketsScreen";

export const metadata: Metadata = { title: "Markets", description: "Every Unison market: last uniform price, regime and band, live." };

export default function MarketsPage() {
  return (
    <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:py-12 [&>*]:max-w-[1200px]">
      <h1 className="text-display-m text-ink">Markets</h1>
      <MarketsClient />
      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-3">
        Prices are each market&apos;s last uniform clearing price. On each dial, twelve o&apos;clock is the reference, the arc is
        the band the next auction may clear in (wider while a market is in discovery), and the hand is where the last
        auction cleared.
      </p>
    </div>
  );
}
