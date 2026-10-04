import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradeClient } from "@/components/trade/TradeClient";
import { MARKETS, marketByTicker } from "@/lib/content/markets";

export function generateStaticParams() {
  return MARKETS.map((m) => ({ symbol: m.ticker }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const m = marketByTicker(symbol);
  return { title: m ? `${m.ticker} · ${m.name}` : "Trade" };
}

export default async function TradePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const m = marketByTicker(symbol);
  if (!m) notFound();
  return <TradeClient ticker={m.ticker} />;
}
