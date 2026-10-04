import type { Metadata } from "next";
import { MarketsClient } from "@/components/app/pages";

export const metadata: Metadata = { title: "Markets", description: "Every Unison market: last uniform price, regime and band, live." };

export default function MarketsPage() {
  return <MarketsClient />;
}
