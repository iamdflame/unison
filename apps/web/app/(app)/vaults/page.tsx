import type { Metadata } from "next";
import { VaultsClient } from "@/components/app/screens/VaultsScreen";

export const metadata: Metadata = { title: "Vaults" };

export default function VaultsPage() {
  return (
    <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:py-12">
      <header className="max-w-3xl">
        <h1 className="text-display-m text-ink">Vaults</h1>
        <p className="text-lede mt-4 text-ink-2">
          Every market has a vault: liquidity that is always there, priced against the reference. It earns the spread, and
          reports on-chain how much came from the spread and how much from inventory moving with the market.
        </p>
      </header>
      <VaultsClient />
    </div>
  );
}
