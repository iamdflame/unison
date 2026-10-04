import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VaultDetailClient } from "@/components/app/screens/VaultDetailScreen";
import { MARKETS, marketByTicker } from "@/lib/content/markets";

export function generateStaticParams() {
  return MARKETS.filter((m) => m.vault).map((m) => ({ symbol: m.ticker }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const m = marketByTicker(symbol);
  return { title: m ? `${m.ticker} vault` : "Vault" };
}

export default async function VaultPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const m = marketByTicker(symbol);
  if (!m?.vault) notFound();
  return <VaultDetailClient ticker={m.ticker} />;
}
